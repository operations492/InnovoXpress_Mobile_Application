import {
  Text as RNText,
  StyleSheet,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { color, font } from '@/theme/tokens';

/**
 * Typography, one component per role in the mockups.
 *
 * Wrapping RN's Text rather than styling it at each call site is what keeps the
 * three families straight: Unbounded for display, Plus Jakarta for prose,
 * Sometype Mono for anything a driver reads out loud or types into a system —
 * ids, phone numbers, timestamps.
 */

// StyleProp, not TextStyle[]: every call site composes styles conditionally
// (`[base, done ? doneStyle : null]`), and a stricter type rejects the null.
type Props = TextProps & { style?: StyleProp<TextStyle> };

/**
 * How far the OS text-size setting may enlarge type here.
 *
 * Android allows up to 200% and iOS's accessibility sizes go further still.
 * Unbounded, that breaks this UI rather than adapting it: status chips, buttons
 * and badges are laid out against fixed metrics from the mockups, and doubling
 * the glyphs pushes labels straight out of their own pill.
 *
 * 1.3 is the largest multiplier every control absorbs — paired with the
 * `minHeight` (rather than `height`) on those controls, so they grow with the
 * text instead of clipping it. Raising this number means re-checking the dense
 * ones: `Chip`, `TaskCard`'s status badge, and the tab bar.
 *
 * Applied before `{...rest}` so a specific call site can still opt out.
 */
const MAX_FONT_SCALE = 1.3;

const base: TextStyle = { color: color.body, fontFamily: font.regular };

const styles = StyleSheet.create({
  display: {
    ...base,
    fontFamily: font.display,
    fontSize: 18,
    color: color.ink,
    letterSpacing: -0.2,
  },
  title: { ...base, fontFamily: font.semibold, fontSize: 16, color: color.ink },
  body: { ...base, fontSize: 14, color: color.body },
  small: { ...base, fontSize: 13, color: color.muted },
  tiny: { ...base, fontSize: 12, color: color.muted },
  /** The mockup's `.sec-label` — uppercase, letter-spaced, monospace. */
  section: {
    fontFamily: font.monoBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: color.muted,
  },
  mono: { ...base, fontFamily: font.mono, fontSize: 13, color: color.ink },
});

export const Display = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.display, style]} />
);
export const Title = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.title, style]} />
);
export const Body = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.body, style]} />
);
export const Small = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.small, style]} />
);
export const Tiny = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.tiny, style]} />
);
export const SectionLabel = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.section, style]} />
);
export const Mono = ({ style, ...rest }: Props) => (
  <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...rest} style={[styles.mono, style]} />
);
