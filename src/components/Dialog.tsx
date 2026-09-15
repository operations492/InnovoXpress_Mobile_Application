import { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, radius, shadow } from '@/theme/tokens';
import { PrimaryButton, SecondaryButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Body, Display } from './Text';

/**
 * The app's own dialog, replacing `Alert.alert`.
 *
 * `Alert` draws whatever the OS draws — Material 3 on one phone, UIKit on
 * another, the manufacturer's reskin on a third. Every one of them arrives in a
 * different typeface, corner radius and button order than the rest of this app,
 * which is transcribed from the Iris mockups down to the shade. The moments this
 * thing appears in are the ones that matter most — confirming an item count,
 * discarding a signature, closing a stop that cannot be reopened — so they are
 * the last places worth handing to a stranger's design.
 *
 * ## Why an imperative API rather than a component
 *
 * Two of the call sites (`lib/navigate.ts`, `features/pod/capture.ts`) are plain
 * modules with no React tree to hang state on, and the rest are inside callbacks
 * where threading `visible` state through would mean a `useState` per dialog.
 * Alert's own shape — call a function, get an answer — is genuinely the right
 * one here; only its rendering was ever the problem.
 *
 * So a single `<DialogHost />` mounts once at the root and registers itself in a
 * module-level slot. `showDialog()` posts to that slot from anywhere and returns
 * a promise resolving to the chosen action's value, or `null` if dismissed. That
 * makes the conversion from `Alert.alert` mechanical, and lets a call site
 * either pass `onPress` handlers or await the result, whichever reads better.
 */

export type DialogTone = 'info' | 'warn' | 'danger' | 'success';

export interface DialogAction {
  label: string;
  /**
   * `primary` fills, the rest are outlined. Ordering is presentational only —
   * actions render in the order given, so put the affirmative one first.
   */
  style?: 'primary' | 'cancel' | 'danger';
  onPress?: () => void;
  /** What the promise resolves to. Defaults to the label. */
  value?: string;
}

export interface DialogOptions {
  title: string;
  message?: string;
  tone?: DialogTone;
  /** Overrides the tone's default glyph. */
  icon?: IconName;
  /** Defaults to a single "OK", which makes this an acknowledgement. */
  actions?: DialogAction[];
  /**
   * Whether the scrim and the Android back button dismiss it. Defaults to true
   * — but a dialog whose only action is destructive should set this false, so
   * the driver cannot back out of a decision without having made one.
   */
  dismissible?: boolean;
}

const TONE: Record<DialogTone, { icon: IconName; tint: string; soft: string }> = {
  info: { icon: 'info', tint: color.primary, soft: color.primarySoft },
  warn: { icon: 'alert-triangle', tint: color.warn, soft: color.warnSoft },
  danger: { icon: 'alert-octagon', tint: color.danger, soft: color.dangerSoft },
  success: { icon: 'check-circle', tint: color.success, soft: color.successSoft },
};

const OK: DialogAction[] = [{ label: 'OK', style: 'primary' }];

interface Entry {
  id: number;
  options: DialogOptions;
  resolve: (value: string | null) => void;
}

type Post = (entry: Entry) => void;

let post: Post | null = null;
let nextId = 1;

/**
 * Dialogs raised before the host has mounted are held, not dropped.
 *
 * Only reachable in the first frames after launch, but a swallowed dialog there
 * would be a silent failure in exactly the code least likely to be re-run.
 */
const buffered: Entry[] = [];

/**
 * Raise a dialog from anywhere — component, callback, or a module with no tree.
 *
 * Resolves with the chosen action's `value` (defaulting to its label), or `null`
 * if the driver dismissed it. Awaiting is optional; `onPress` handlers fire
 * either way.
 */
export function showDialog(options: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const entry: Entry = { id: nextId++, options, resolve };
    if (post) post(entry);
    else buffered.push(entry);
  });
}

/**
 * Mounted once, at the root, above everything else in the tree.
 *
 * `Modal` gets its own window on Android and its own root view on iOS, so this
 * sits over the tab bar, over an inverted chat list, and over the map — all
 * three of which have beaten a plain absolutely-positioned overlay in this app
 * before.
 */
export function DialogHost() {
  /*
   * Anything buffered before this mounted is picked up in the initialiser
   * rather than by a setState in the effect below — the latter is a second
   * render for no reason, and React's own lint rule rejects it. Copied, not
   * drained, because a StrictMode double-invoke of this initialiser would
   * otherwise consume the entries into a render that gets thrown away; the
   * effect does the draining exactly once.
   */
  const [queue, setQueue] = useState<Entry[]>(() => [...buffered]);
  const insets = useSafeAreaInsets();
  const current = queue[0] ?? null;
  const currentId = current?.id;

  useEffect(() => {
    buffered.length = 0;
    post = (entry) => setQueue((q) => [...q, entry]);
    return () => {
      post = null;
    };
  }, []);

  /*
   * Resolve first, then drop. A caller awaiting this is usually about to start
   * an upload, and leaving it parked behind a render is how a "Saving…" state
   * ends up waiting on a dialog that is already gone.
   */
  const close = useCallback((entry: Entry, action: DialogAction | null) => {
    setQueue((q) => q.filter((e) => e.id !== entry.id));
    entry.resolve(action ? (action.value ?? action.label) : null);
    action?.onPress?.();
  }, []);

  /*
   * Animated per entry, keyed on the id, so a second dialog queued behind the
   * first still gets its own entrance rather than appearing fully-formed in the
   * shell the previous one left behind.
   */
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (currentId === undefined) return;
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [currentId, enter]);

  if (!current) return null;

  const { options } = current;
  const actions = options.actions?.length ? options.actions : OK;
  const dismissible = options.dismissible ?? true;
  const tone = TONE[options.tone ?? 'info'];

  const dismiss = () => {
    if (dismissible) close(current, null);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable
        /*
         * The safe-area padding belongs HERE, not on the wrapper below.
         *
         * This is the only element in the tree with a definite height — `flex: 1`
         * against the Modal's full-screen root. Padding it is what makes the
         * space the card may occupy genuinely bounded, which is the precondition
         * for the percentage cap on the wrapper resolving to anything at all.
         */
        style={[
          styles.scrim,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
        ]}
        // The scrim is a tap target only when it does something. Marked as such
        // for screen readers rather than announcing an unlabelled button.
        accessibilityRole={dismissible ? 'button' : undefined}
        accessibilityLabel={dismissible ? 'Dismiss' : undefined}
        onPress={dismiss}
      >
        {/*
          Stops a tap on the card itself from bubbling to the scrim. `onPress`
          with no handler is deliberate — RN has no stopPropagation, and an
          empty responder is how a child opts out of its parent's press.
        */}
        <Pressable onPress={() => undefined} style={styles.cardWrap}>
          <Animated.View
            style={[
              styles.card,
              shadow.float,
              {
                opacity: enter,
                transform: [
                  { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ],
              },
            ]}
          >
            <View style={[styles.badge, { backgroundColor: tone.soft }]}>
              <Icon name={options.icon ?? tone.icon} size={24} color={tone.tint} />
            </View>

            <Display style={styles.title}>{options.title}</Display>

            {options.message ? (
              // Scrolls rather than clips: the longest of these carries two
              // numbers the driver has to compare, and losing the second one to
              // a small screen would defeat the dialog.
              <ScrollView
                style={styles.messageScroll}
                contentContainerStyle={styles.messageContent}
                bounces={false}
              >
                <Body style={styles.message}>{options.message}</Body>
              </ScrollView>
            ) : null}

            <View style={styles.actions}>
              {actions.map((action) =>
                action.style === 'primary' || !action.style ? (
                  <PrimaryButton
                    key={action.label}
                    label={action.label}
                    onPress={() => close(current, action)}
                  />
                ) : (
                  <SecondaryButton
                    key={action.label}
                    label={action.label}
                    tone={action.style === 'danger' ? 'danger' : 'default'}
                    onPress={() => close(current, action)}
                    style={styles.secondary}
                  />
                ),
              )}
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    // The ink token at 45% — the mockups' own overlay, not a generic black.
    backgroundColor: 'rgba(26, 26, 46, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  /*
   * `maxHeight: '100%'` works here and did NOT work on the card before.
   *
   * A percentage resolves against the parent's height, and this wrapper's parent
   * — the scrim — is `flex: 1`, so its height is definite. The card's old
   * `maxHeight: '82%'` was measured against THIS wrapper, which had no height of
   * its own and simply grew to fit its content: a percentage of "as tall as you
   * like" is not a limit, so the cap never applied and a tall dialog ran off the
   * bottom of the screen.
   */
  cardWrap: {
    width: '100%',
    // Keeps the dialog a dialog on a tablet or a landscape phone, where a
    // full-width card would stretch the message to an unreadable line length.
    maxWidth: 420,
    maxHeight: '100%',
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    alignItems: 'center',
    gap: 10,
    /*
     * Flex children default to `flexShrink: 0`, so without this the card keeps
     * its full content height even once the wrapper is capped — and overflows
     * it, clipping the buttons at the bottom. This is the half of the fix that
     * actually stops the cut.
     */
    flexShrink: 1,
  },
  badge: {
    width: 54,
    height: 54,
    flexShrink: 0,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: { textAlign: 'center', fontSize: 17, flexShrink: 0 },
  /*
   * The message is the ONLY thing allowed to give up space, and the buttons are
   * explicitly protected from it.
   *
   * When the card hits its cap something has to yield, and the answer must never
   * be the actions: a dialog whose buttons are off-screen cannot be answered or
   * dismissed, which on a blocking confirmation traps the driver mid-delivery.
   * So the text scrolls and everything else holds its size.
   */
  messageScroll: { alignSelf: 'stretch', flexShrink: 1 },
  messageContent: { paddingVertical: 2 },
  message: { textAlign: 'center', color: color.body, lineHeight: 20, fontFamily: font.regular },
  actions: { alignSelf: 'stretch', gap: 8, marginTop: 12, flexShrink: 0 },
  // Matches PrimaryButton's height so a stack of mixed buttons reads as a set.
  secondary: { justifyContent: 'center', minHeight: 48 },
});
