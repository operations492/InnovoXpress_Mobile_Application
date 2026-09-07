import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { File as FsFile } from 'expo-file-system';

import { showDialog } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState, LoadingState } from '@/components/States';
import { Body, Small, Tiny } from '@/components/Text';
import { MessageBubble } from '@/components/chat/MessageBubble';
import {
  newClientMessageId,
  useConversations,
  useMarkRead,
  useMessages,
  useSendAttachment,
  useSendMessage,
} from '@/features/chat/queries';
import type { DeliveryState } from '@/features/chat/types';
import { useMe } from '@/features/tasks/queries';
import { formatBytes } from '@/lib/format';
import { color, font, radius } from '@/theme/tokens';

/**
 * One thread.
 *
 * The list is INVERTED, which is not decoration: it keeps the newest message
 * pinned above the composer, grows upward as the keyboard opens, and needs no
 * scroll-to-end call that would race the layout. The server already returns
 * newest-first, so the data needs no reversing — the two conventions line up.
 */

/** The server's own ceiling: CHAT_MAX_FILE_BYTES, and a CHECK constraint behind it. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export default function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id ?? '';
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: me } = useMe();

  /*
   * The thread's title comes from the conversation list rather than a second
   * request: the server already labels a DIRECT thread with the counterpart's
   * name per viewer, and that list is cached from the screen the driver just
   * came from. Falling back to Messages covers a cold deep link, where the
   * list is still in flight.
   */
  const { data: conversations } = useConversations();
  const counterpart = conversations?.data.find((c) => c.id === conversationId)?.name;

  // Undefined until the list resolves, which is why the two fall back separately
  // rather than sharing one string: 'Message Messages…' is worse than neither.
  const title = counterpart ?? 'Messages';
  const placeholder = counterpart ? `Message ${counterpart}…` : 'Type a message…';

  /*
   * Explicit, because the default is wrong here. `ScreenHeader` falls back to
   * `router.replace('/')` when there is no history — and `/` is the Tasks tab,
   * so a driver returning from this screen was thrown out of chat entirely.
   */
  const goBack = useCallback(() => {
    /*
     * `dismissTo`, not `back()`.
     *
     * This route is pushed OUTSIDE the tab group, so popping it returns to the
     * group — and the group restores its default tab, which is Tasks. The driver
     * pressed back on a conversation and landed on their job list.
     *
     * `dismissTo` names the destination instead of trusting whatever is
     * underneath, so back from a thread is always the thread list.
     */
    if (router.canDismiss()) router.dismissTo('/chat');
    else router.replace('/chat');
  }, [router]);
  const { data, isLoading, isError, error, refetch } = useMessages(conversationId);
  const sendMessage = useSendMessage(conversationId, me?.id);
  const sendAttachment = useSendAttachment(conversationId);
  const markRead = useMarkRead(conversationId);

  const keyboard = useAnimatedKeyboard();
  /*
   * The keyboard OR the gesture bar — never both.
   *
   * These were being added together: the lift reserved the keyboard height and
   * the composer separately padded for the safe-area inset, leaving a dead strip
   * under the input the height of the home indicator while typing. An open
   * keyboard already covers that area, so the larger of the two is the whole
   * requirement.
   */
  const liftStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value, insets.bottom),
  }));

  const [draft, setDraft] = useState('');

  /**
   * Send state for messages this device is currently pushing.
   *
   * Kept beside the cache rather than in it: the cached message is the server's,
   * and "sending" is a fact about this phone. Keyed by `clientMessageId`, which
   * is the only id an in-flight message has.
   */
  const [pending, setPending] = useState<Record<string, DeliveryState>>({});

  const messages = useMemo(() => data?.data ?? [], [data]);
  const newestId = messages[0]?.id;

  /**
   * Mark read on the newest message actually rendered.
   *
   * Guarded by a ref so arriving messages do not fire a request each: the server
   * only cares about the high-water mark, and one call per message would be a
   * write per broadcast.
   */
  const lastMarked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!newestId || lastMarked.current === newestId) return;
    lastMarked.current = newestId;
    markRead(newestId);
  }, [newestId, markRead]);

  const rows = useMemo(
    () =>
      messages.map((message, i) => {
        // Newest-first, so the chronologically previous message is the NEXT index.
        const previous = messages[i + 1];
        const sameSender = previous?.senderId === message.senderId;
        const close =
          previous !== undefined &&
          Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;

        return {
          message,
          mine: message.senderId === me?.id,
          // An attachment always gets its own bubble spacing.
          grouped: Boolean(sameSender && close && message.type === 'TEXT' && !message.attachment),
          daySeparator:
            previous === undefined || !sameDay(message.createdAt, previous.createdAt)
              ? dayLabel(message.createdAt)
              : null,
        };
      }),
    [messages, me?.id],
  );

  const canSend = draft.trim().length > 0 && !sendMessage.isPending;

  const onSend = useCallback(() => {
    const body = draft.trim();
    if (!body) return;

    /*
     * The id belongs to the ATTEMPT. There is a unique index on
     * (conversationId, clientMessageId), so replaying it after a lost response
     * returns the original message instead of posting twice — which is the
     * whole point on a phone with one bar.
     */
    const clientMessageId = newClientMessageId();
    setDraft('');
    setPending((p) => ({ ...p, [clientMessageId]: 'sending' }));

    sendMessage.mutate(
      { body, clientMessageId },
      {
        onSuccess: () => setPending((p) => ({ ...p, [clientMessageId]: 'sent' })),
        onError: () => {
          setPending((p) => ({ ...p, [clientMessageId]: 'failed' }));
          // Put it back so it is not lost — retyping a message the app ate is
          // the fastest way to lose a driver's trust.
          setDraft((current) => (current ? current : body));
        },
      },
    );
  }, [draft, sendMessage]);

  /**
   * Everything after "the driver chose a photo", shared by both sources.
   *
   * The camera is the one that matters here: the reason to send dispatch a
   * picture is almost always something happening in front of the driver right
   * now — a blocked loading bay, a damaged pallet, a door with nobody behind it.
   * Making them leave the app, open the camera and come back to attach it is
   * three steps too many at the kerbside.
   */
  const sendPicked = useCallback(
    (picked: ImagePicker.ImagePickerResult) => {
      if (picked.canceled || !picked.assets[0]) return;

      const asset = picked.assets[0];
    const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
    const type = asset.mimeType ?? 'image/jpeg';

    /*
     * Checked here as well as on the server, because failing at the composer is
     * a sentence and failing at the server is a 413 after uploading five
     * megabytes over a mobile connection.
     */
    const size = asset.fileSize ?? sizeOf(asset.uri);
    if (size !== null && size > MAX_ATTACHMENT_BYTES) {
      void showDialog({
        title: 'Photo is too large',
        tone: 'warn',
        message: `That photo is ${formatBytes(size)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)} — take a new one, or pick a smaller file.`,
      });
      return;
    }

    const clientMessageId = newClientMessageId();
    const caption = draft.trim();
    setDraft('');
    setPending((p) => ({ ...p, [clientMessageId]: 'sending' }));

    const form = new FormData();
    /*
     * Expo's WinterCG fetch rejects React Native's `{uri,name,type}` part and
     * takes a Blob or anything exposing `bytes()`. The name and type are pinned
     * from the picker rather than left to the OS, because busboy treats a part
     * with no filename as a text field — the upload would arrive with no file at
     * all and fail validation instead of failing here.
     */
    form.append('file', {
      name,
      type,
      bytes: () => new FsFile(asset.uri).bytes(),
    } as unknown as Blob);
    form.append('clientMessageId', clientMessageId);
    if (caption) form.append('body', caption);

      sendAttachment.mutate(form, {
        onSuccess: () => setPending((p) => ({ ...p, [clientMessageId]: 'sent' })),
        onError: () => {
          setPending((p) => ({ ...p, [clientMessageId]: 'failed' }));
          void showDialog({
            title: 'Photo not sent',
            tone: 'danger',
            message: 'Check your signal and try again.',
          });
        },
      });
    },
    [draft, sendAttachment],
  );

  /** Same compression for both sources — see the note in `sendPicked`. */
  const IMAGE_OPTIONS: ImagePicker.ImagePickerOptions = useMemo(
    () => ({ mediaTypes: ['images'], quality: 0.7, exif: false }),
    [],
  );

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      void showDialog({
        title: 'The camera is switched off',
        tone: 'warn',
        icon: 'lock',
        message: 'Innovo Xpress needs camera access to take a photo for dispatch.',
      });
      return;
    }
    sendPicked(await ImagePicker.launchCameraAsync(IMAGE_OPTIONS));
  }, [IMAGE_OPTIONS, sendPicked]);

  const choosePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      void showDialog({
        title: 'Photos are switched off',
        tone: 'warn',
        icon: 'lock',
        message: 'Innovo Xpress needs access to your photos to send one to dispatch.',
      });
      return;
    }
    sendPicked(await ImagePicker.launchImageLibraryAsync(IMAGE_OPTIONS));
  }, [IMAGE_OPTIONS, sendPicked]);

  /**
   * A small menu at the paperclip, not a centred dialog.
   *
   * A modal over the whole screen for a two-option choice appears nowhere near
   * the control that opened it. Anchoring the choice to the button keeps the
   * driver's eye and thumb where they already were — which is why this stayed a
   * popover even once `showDialog` gave centred dialogs the app's own styling.
   */
  const [attachOpen, setAttachOpen] = useState(false);

  const pick = useCallback(
    (source: 'camera' | 'library') => {
      setAttachOpen(false);
      if (source === 'camera') void takePhoto();
      else void choosePhoto();
    },
    [takePhoto, choosePhoto],
  );

  if (isLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ScreenHeader title={title} onBack={goBack} />
        <LoadingState label="Opening thread…" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ScreenHeader title={title} onBack={goBack} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader title={title} onBack={goBack} />

      <Animated.View style={[styles.fill, liftStyle]}>
        <FlatList
          inverted
          data={rows}
          keyExtractor={(row) => row.message.id}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyThread />}
          renderItem={({ item }) => (
            // Separator first: `inverted` reverses the order of CELLS, not the
            // layout inside one, so it reads exactly as in a normal list.
            <View>
              {item.daySeparator ? (
                <View style={styles.dayRow}>
                  <View style={styles.dayLine} />
                  <Tiny style={styles.dayText}>{item.daySeparator}</Tiny>
                  <View style={styles.dayLine} />
                </View>
              ) : null}
              <MessageBubble
                message={item.message}
                mine={item.mine}
                grouped={item.grouped}
                conversationId={conversationId}
                delivery={
                  item.message.clientMessageId
                    ? pending[item.message.clientMessageId]
                    : undefined
                }
                onRetry={(m) => {
                  if (!m.body || !m.clientMessageId) return;
                  setPending((p) => ({ ...p, [m.clientMessageId!]: 'sending' }));
                  sendMessage.mutate(
                    { body: m.body, clientMessageId: m.clientMessageId },
                    {
                      onSuccess: () =>
                        setPending((p) => ({ ...p, [m.clientMessageId!]: 'sent' })),
                      onError: () =>
                        setPending((p) => ({ ...p, [m.clientMessageId!]: 'failed' })),
                    },
                  );
                }}
              />
            </View>
          )}
        />

        {/* No `insets.bottom`: this route is pushed over the tabs and the
            keyboard lift above already reclaims the bottom of the window. */}
        {sendAttachment.isPending ? (
          <View style={styles.uploading}>
            <ActivityIndicator size="small" color={color.primary} />
            <Tiny style={styles.uploadingText}>Sending photo…</Tiny>
          </View>
        ) : null}

        <View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
            onPress={() => setAttachOpen((open) => !open)}
            disabled={sendAttachment.isPending}
            style={({ pressed }) => [styles.attach, pressed ? { opacity: 0.7 } : null]}
          >
            <Icon
              name="paperclip"
              size={19}
              color={sendAttachment.isPending ? color.faint : color.muted}
            />
          </Pressable>

          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={color.faint}
            style={styles.input}
            multiline
            maxLength={4000}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            onPress={onSend}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.send,
              !canSend && styles.sendOff,
              pressed && canSend ? { opacity: 0.85 } : null,
            ]}
          >
            <Icon name="send" size={17} color={canSend ? color.onPrimary : color.faint} />
          </Pressable>
        </View>

        {/*
          Rendered LAST on purpose.

          The thread above is an inverted FlatList, and the `scaleY: -1`
          transform that inverts it gives it its own layer on Android — enough
          that a menu declared before it lost the z-fight and drew behind the
          messages, even with elevation set. Being the final sibling settles the
          order without relying on zIndex behaving alike on both platforms.
        */}
        {attachOpen ? (
          <>
            {/* Catches the tap that dismisses. Transparent and behind the menu,
                so it never intercepts the menu's own presses. */}
            <Pressable
              accessibilityLabel="Close attachment menu"
              onPress={() => setAttachOpen(false)}
              style={styles.scrim}
            />
            <View style={styles.menu}>
              <Pressable
                accessibilityRole="button"
                onPress={() => pick('camera')}
                style={({ pressed }) => [styles.menuItem, pressed ? styles.menuPressed : null]}
              >
                <Icon name="camera" size={17} color={color.ink} />
                <Body style={styles.menuText}>Take photo</Body>
              </Pressable>
              <View style={styles.menuLine} />
              <Pressable
                accessibilityRole="button"
                onPress={() => pick('library')}
                style={({ pressed }) => [styles.menuItem, pressed ? styles.menuPressed : null]}
              >
                <Icon name="image" size={17} color={color.ink} />
                <Body style={styles.menuText}>Choose from library</Body>
              </Pressable>
            </View>
          </>
        ) : null}

      </Animated.View>
    </View>
  );
}

/** Best-effort local size when the picker does not report one. */
function sizeOf(uri: string): number | null {
  try {
    return new FsFile(uri).size ?? null;
  } catch {
    return null;
  }
}

function EmptyThread() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Icon name="message-circle" size={24} color={color.primary} />
      </View>
      <Body style={styles.emptyTitle}>No messages yet</Body>
      <Small style={styles.emptyText}>
        Anything about a job — a locked gate, a wrong address, a customer who is not
        answering — send it to dispatch here.
      </Small>
    </View>
  );
}

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** "Today" and "Yesterday" carry more than a date does on a shift this long. */
function dayLabel(iso: string): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(iso, now.toISOString())) return 'Today';
  if (sameDay(iso, yesterday.toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  fill: { flex: 1 },
  list: { paddingVertical: 10, flexGrow: 1 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    marginTop: 16,
    marginBottom: 2,
  },
  dayLine: { flex: 1, height: 1, backgroundColor: color.line },
  dayText: { fontSize: 11, color: color.faint, fontFamily: font.medium },

  /*
   * Anchored to the paperclip rather than centred on the screen: the choice
   * belongs to that button, and a dialog in the middle of the display makes the
   * driver look away from where they just tapped.
   */
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  menu: {
    position: 'absolute',
    left: 10,
    bottom: 62,
    zIndex: 11,
    minWidth: 208,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    overflow: 'hidden',
    // Lifts it off the thread behind; without this it reads as part of the list.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 13 },
  menuPressed: { backgroundColor: color.surfaceSoft },
  menuText: { fontSize: 14.5, color: color.ink },
  menuLine: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },

  uploading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: color.primarySoft,
  },
  uploadingText: { color: color.primary, fontFamily: font.medium },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  attach: {
    width: 42,
    height: 42,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSoft,
    borderWidth: 1,
    borderColor: color.line,
    fontFamily: font.regular,
    fontSize: 14.5,
    color: color.ink,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: radius.lg,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: color.surfaceSoft },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 40,
    paddingVertical: 60,
    transform: [{ scaleY: -1 }],
  },
  emptyBadge: {
    width: 58,
    height: 58,
    borderRadius: radius.card,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontFamily: font.semibold, color: color.ink },
  emptyText: { textAlign: 'center', color: color.muted, lineHeight: 19 },
});
