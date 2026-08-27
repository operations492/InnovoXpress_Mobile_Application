import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useShift } from '@/state/ShiftProvider';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { Tiny } from './Text';

/**
 * Shift state, shown rather than controlled.
 *
 * Opening the app puts the driver on shift; there is nothing here to press. The
 * switch this replaced was the single largest source of confusion in the app —
 * a driver who forgot to flip it looked exactly like a driver sitting still, and
 * dispatch could not tell "not working" from "not reporting".
 *
 * It stays on screen because the state is still worth knowing, and because the
 * two ways it can be wrong are worth seeing:
 *
 *  - "Off shift" now means the server has not accepted the clock-on yet — no
 *    signal at launch, most often. It clears itself on the next attempt.
 *  - The warning icon means on shift but NOT reporting: the shift is open and
 *    the OS is giving us no fixes. A green pill over a silent phone would be the
 *    same lie the toggle used to tell.
 */
export function ShiftStatus() {
  const { onShift, busy, tracking } = useShift();

  const label = busy ? 'Starting…' : onShift ? 'On shift' : 'Off shift';

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={
        onShift
          ? tracking
            ? 'On shift, location reporting.'
            : 'On shift, but not reporting location.'
          : 'Not on shift yet.'
      }
      style={[styles.pill, onShift ? styles.on : styles.off]}
    >
      <Tiny style={[styles.label, { color: onShift ? color.successText : color.muted }]}>
        {label}
      </Tiny>

      <View style={[styles.knob, { backgroundColor: onShift ? color.success : color.faint }]}>
        {busy ? (
          <ActivityIndicator size="small" color={color.onPrimary} />
        ) : (
          <Icon
            name={onShift ? (tracking ? 'navigation' : 'alert-triangle') : 'power'}
            size={14}
            color={color.onPrimary}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingVertical: 6,
    paddingLeft: 13,
    paddingRight: 6,
    borderRadius: radius.pill,
  },
  on: { backgroundColor: color.successSoft },
  off: { backgroundColor: color.surfaceSoft },
  label: { fontFamily: font.bold, fontSize: 12.5 },
  knob: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
