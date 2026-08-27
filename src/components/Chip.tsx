import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, font, radius } from '@/theme/tokens';
import { Tiny } from './Text';

/**
 * The mockup's `.chip`. `tone` maps to the four variants it defines; `accent`
 * overrides them for a status pill, whose colour is driven by the state machine
 * rather than by a fixed class.
 */
type Tone = 'primary' | 'danger' | 'neutral' | 'mono';

interface Props {
  label: string;
  tone?: Tone;
  /** Overrides `tone` — the 12%/30% soft fill the status pill uses. */
  accent?: string;
  dot?: boolean;
  style?: ViewStyle;
}

const TONES: Record<Tone, { fg: string; bg: string; border: string }> = {
  primary: { fg: color.primary, bg: color.primarySoft, border: color.primaryBorder },
  danger: { fg: color.dangerText, bg: color.dangerSoft, border: color.dangerBorder },
  neutral: { fg: color.body, bg: color.surfaceSoft, border: color.line },
  mono: { fg: color.muted, bg: color.surfaceSoft, border: color.line },
};

/** `color-mix(in srgb, c pct%, transparent)` has no RN equivalent; 8-digit hex does. */
function alpha(hex: string, pct: number): string {
  const a = Math.round((pct / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export function Chip({ label, tone = 'neutral', accent, dot = false, style }: Props) {
  const palette = accent
    ? { fg: accent, bg: alpha(accent, 12), border: alpha(accent, 30) }
    : TONES[tone];

  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: palette.fg }]} /> : null}
      <Tiny
        numberOfLines={1}
        style={[
          styles.label,
          { color: palette.fg, fontFamily: tone === 'mono' ? font.monoBold : font.bold },
        ]}
      >
        {label}
      </Tiny>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // minHeight so a scaled-up label makes the pill taller instead of clipping.
    minHeight: 24,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  // No fixed lineHeight: it does not scale with the OS text size, so pinning it
  // clips descenders the moment the user enlarges type.
  label: { fontSize: 11.5 },
});
