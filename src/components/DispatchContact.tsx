import { Pressable, StyleSheet, View } from 'react-native';

import { env } from '@/lib/env';
import { callNumber } from '@/lib/navigate';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { Small, Tiny } from './Text';

/**
 * Ringing the operations desk from the proof screen.
 *
 * This lives here and nowhere else on purpose. The proof screen is where a stop
 * actually stalls — a count that will not reconcile, goods refused, nobody
 * willing to sign — and it is the one screen a driver cannot simply leave, since
 * the save is blocked until every requirement is met. Everywhere else in the app
 * the driver still has options.
 *
 * Deliberately kept away from the task screen's Navigate / Call / SMS row too.
 * Those dial the sender or the receiver and swap over halfway through the job;
 * this dials Innovo and never changes. Sitting them together is how a driver
 * reaching for "Call" at a locked warehouse door rings the customer they are
 * standing outside of.
 */
/**
 * The call itself, on its own, so it can appear somewhere other than the card.
 *
 * `compact` is for placing it inside another block — shorter, and without the
 * number printed underneath. The shape and colour stay identical to the card's
 * button on purpose: a driver who has learned what the purple phone button does
 * at the bottom of this screen should not have to learn it again halfway up.
 *
 * Renders nothing when no number is configured, for the same reason the card
 * does — see below. The card carries the development warning; repeating it at
 * every call site would just be noise.
 */
export function CallDispatchButton({ compact = false }: { compact?: boolean }) {
  const phone = env.dispatchPhone;
  if (!phone) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Call dispatch on ${phone}`}
      onPress={() => callNumber(phone, 'dispatch')}
      style={({ pressed }) => [
        styles.call,
        compact ? styles.callCompact : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Icon name="phone" size={compact ? 14 : 16} color={color.onPrimary} />
      <Small style={[styles.callLabel, compact ? styles.callLabelCompact : null]}>
        Call dispatch
      </Small>
    </Pressable>
  );
}

export function DispatchContact({ reason }: { reason?: string }) {
  const phone = env.dispatchPhone;

  /*
   * Nothing at all when no number is configured.
   *
   * A greyed-out "Call dispatch" teaches a driver that calling dispatch does not
   * work — worse than the row simply not being there, and worse than the truth,
   * which is that nobody has set the number yet.
   *
   * In development it says so instead of vanishing. Silent absence is
   * indistinguishable from a broken component, and `EXPO_PUBLIC_*` values are
   * inlined when the bundle is built — so the usual reason this is empty is a
   * Metro that was reloaded rather than restarted, which is not a thing anyone
   * guesses from a blank space.
   */
  if (!phone) {
    if (!__DEV__) return null;
    return (
      <View style={[styles.card, styles.unset]}>
        <Tiny style={styles.unsetText}>
          Dispatch number not set. Put `EXPO_PUBLIC_DISPATCH_PHONE` in .env and RESTART Metro — a
          reload will not pick it up. Drivers see nothing here until it is set.
        </Tiny>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {reason ? <Small style={styles.reason}>{reason}</Small> : null}

      <CallDispatchButton />

      <Tiny style={styles.number}>{phone}</Tiny>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginTop: 16,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    gap: 9,
  },
  reason: { color: color.body, fontSize: 12.5, lineHeight: 17 },

  // Dev-only, and dressed as a warning so it is never mistaken for driver copy.
  unset: { backgroundColor: color.warnSoft, borderColor: color.warn },
  unsetText: { color: color.warn, fontSize: 11.5, lineHeight: 16 },

  call: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    // minHeight, not height: the label grows with the OS text size.
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: color.primary,
  },
  callLabel: { color: color.onPrimary, fontFamily: font.bold, fontSize: 14 },

  // Still a 40pt target — comfortably above the 44dp guideline once the row's
  // padding is counted, and shrinking it further to save a few pixels would
  // trade away the one tap a driver makes while holding a parcel.
  callCompact: { minHeight: 40, gap: 7 },
  callLabelCompact: { fontSize: 13 },

  pressed: { opacity: 0.8 },

  number: { fontFamily: font.mono, fontSize: 11, color: color.muted, textAlign: 'center' },
});
