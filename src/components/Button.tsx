import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { color, font, radius, shadow } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Body } from './Text';

/**
 * The two buttons the mockups define, plus the disabled state the Complete Task
 * screen depends on: its save button is grey and inert until every requirement
 * is satisfied, which is the whole affordance of that screen.
 */

interface PrimaryProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  loading = false,
  style,
}: PrimaryProps) {
  const inert = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={label}
      onPress={inert ? undefined : onPress}
      style={({ pressed }) => [
        styles.primary,
        /*
          Greyed only when DISABLED. A loading button stays brand blue and keeps
          its glow: grey is the app saying "you cannot do this", and a button
          that goes grey the instant it is tapped reads as a rejection rather
          than as work in progress. It is also the only state where a white
          spinner is visible at all.
        */
        disabled ? styles.primaryOff : shadow.glow,
        pressed && !inert ? styles.pressed : null,
        style,
      ]}
    >
      {/*
        The spinner REPLACES the icon, not the label.

        A button that empties itself down to a bare spinner stops saying what it
        is waiting on — and these waits are the ones that matter, because the tap
        that closes a stop cannot be undone from the app. Keeping the words means
        a driver on one bar of signal can still see which action is in flight.
      */}
      {loading ? (
        <ActivityIndicator size="small" color={color.onPrimary} />
      ) : icon ? (
        <Icon name={icon} size={17} color={disabled ? color.faint : color.onPrimary} />
      ) : null}
      <Body style={[styles.primaryLabel, disabled ? { color: color.faint } : null]}>{label}</Body>
    </Pressable>
  );
}

interface SecondaryProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function SecondaryButton({
  label,
  onPress,
  icon,
  tone = 'default',
  disabled = false,
  loading = false,
  style,
}: SecondaryProps) {
  const tint = tone === 'danger' ? color.dangerText : color.ink;
  const inert = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      onPress={inert ? undefined : onPress}
      style={({ pressed }) => [
        styles.secondary,
        pressed && !inert ? styles.secondaryPressed : null,
        // Faded only when disabled — see the note on PrimaryButton.
        disabled ? { opacity: 0.5 } : null,
        style,
      ]}
    >
      {/* Spinner in the button's own tint, taking the icon's slot. */}
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : icon ? (
        <Icon name={icon} size={16} color={tint} />
      ) : null}
      <Body style={[styles.secondaryLabel, { color: tint }]}>{label}</Body>
    </Pressable>
  );
}

/** The 4-up tile row: Navigate · Call · SMS · Email, and the capture row. */
interface TileProps {
  label: string;
  icon: IconName;
  onPress: () => void;
  done?: boolean;
  disabled?: boolean;
}

export function ActionTile({ label, icon, onPress, done = false, disabled = false }: TileProps) {
  const tint = disabled ? color.faint : done ? color.successText : color.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: done }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: disabled
            ? color.surfaceSoft
            : done
              ? color.successSoft
              : pressed
                ? color.primaryPressed
                : color.primarySoft,
        },
      ]}
    >
      <Icon name={done ? 'check-circle' : icon} size={19} color={tint} />
      <Body style={[styles.tileLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Body>
      {done ? (
        <View style={styles.tick}>
          <Icon name="check" size={11} color={color.onPrimary} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    // minHeight, not height: with the OS text size turned up the label has to
    // be able to push the button taller rather than spill out of it.
    minHeight: 52,
    paddingVertical: 8,
    borderRadius: radius.lg,
    backgroundColor: color.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryOff: { backgroundColor: color.surfaceSoft },
  pressed: { backgroundColor: color.primaryHover, transform: [{ scale: 0.985 }] },
  primaryLabel: {
    fontFamily: font.display,
    fontSize: 15,
    color: color.onPrimary,
    includeFontPadding: false,
  },

  secondary: {
    minHeight: 48,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.ctrl,
    backgroundColor: color.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryPressed: { backgroundColor: color.surfaceSoft },
  secondaryLabel: { fontFamily: font.semibold, fontSize: 14 },

  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: radius.lg,
  },
  tileLabel: { fontFamily: font.bold, fontSize: 11.5 },
  tick: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: color.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: color.surface,
  },
});
