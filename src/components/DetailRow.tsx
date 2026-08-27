import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { color, font, radius } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Body, Small, Tiny } from './Text';

/**
 * The `.drow` from the Task info mockup: 34px icon tile, label over value, and a
 * chevron when the row leads somewhere. Tappable and static rows share one
 * component so their metrics cannot drift apart.
 */
interface Props {
  icon: IconName;
  label?: string;
  value?: string;
  sub?: string;
  /** Chips or anything else, rendered instead of `value`. */
  children?: ReactNode;
  mono?: boolean;
  accent?: boolean;
  onPress?: () => void;
  last?: boolean;
  style?: ViewStyle;
}

export function DetailRow({
  icon,
  label,
  value,
  sub,
  children,
  mono = false,
  accent = false,
  onPress,
  last = false,
  style,
}: Props) {
  const content = (
    <>
      <View style={[styles.tile, accent ? styles.tileAccent : null]}>
        <Icon name={icon} size={17} color={accent ? color.primary : color.muted} />
      </View>

      <View style={styles.mid}>
        {label ? <Tiny style={styles.label}>{label}</Tiny> : null}
        {value ? (
          <Body style={[styles.value, mono ? styles.mono : null]} numberOfLines={3}>
            {value}
          </Body>
        ) : null}
        {children}
        {sub ? <Small style={styles.sub}>{sub}</Small> : null}
      </View>

      {onPress ? <Icon name="chevron-right" size={18} color={color.faint} /> : <View />}
    </>
  );

  const rowStyle = [styles.row, last ? styles.last : null, style];

  if (!onPress) return <View style={rowStyle}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, value].filter(Boolean).join(': ')}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
  },
  last: { borderBottomWidth: 0 },
  pressed: { backgroundColor: color.surfaceSoft },
  tile: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileAccent: { backgroundColor: color.primarySoft },
  mid: { flex: 1, gap: 2 },
  label: { fontSize: 12, color: color.muted },
  value: { fontSize: 15, color: color.ink, fontFamily: font.semibold },
  mono: { fontFamily: font.monoMedium, fontSize: 13.5 },
  sub: { fontSize: 12.5, color: color.muted },
});
