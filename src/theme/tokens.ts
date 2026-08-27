/**
 * "Iris" — the token set the HTML mockups are drawn from, transcribed 1:1.
 *
 * Values are literal so a screen can never invent a near-miss shade: if a colour
 * is not here, it is not in the design.
 */

export const color = {
  bgCanvas: '#EFEFF5',
  surface: '#FFFFFF',
  surfaceSoft: '#F5F5FB',

  ink: '#1A1A2E',
  body: '#45455C',
  muted: '#7A7A93',
  faint: '#ADADC2',

  line: '#E6E6F0',
  line2: '#EEEEF6',
  ctrl: '#D8D8E6',

  primary: '#4B3FCF',
  primaryHover: '#3D33B0',
  primarySoft: '#ECEBFB',
  primaryPressed: '#E1DFF8',
  primaryBorder: '#DEDCF7',
  onPrimary: '#FFFFFF',

  success: '#16A34A',
  successText: '#15803D',
  successSoft: '#EAF7EE',
  successBorder: '#CFEEDA',
  successPressed: '#DFF2E6',

  danger: '#DC2626',
  dangerText: '#C6413B',
  dangerSoft: '#FBEBEA',
  dangerBorder: '#F5D9D6',

  transit: '#0891B2',
  transitText: '#0E7490',
  transitSoft: '#E6FAFD',

  warn: '#B26A00',
  warnSoft: '#FFF4E5',
} as const;

/** Status accent colours, matching the mockup's PHASE table. */
export const statusColor = {
  UNASSIGNED: color.muted,
  ASSIGNED: color.primary,
  EN_ROUTE_TO_PICKUP: color.warn,
  AT_PICKUP: color.transitText,
  PICKED_UP: color.transitText,
  EN_ROUTE_TO_DELIVERY: color.warn,
  AT_DELIVERY: color.transitText,
  DELIVERED: color.successText,
} as const;

export const radius = {
  sm: 8,
  md: 11,
  lg: 14,
  card: 16,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 24,
} as const;

/**
 * The mockup's `--e1`. React Native cannot express a spread, so the radius is
 * approximated with elevation on Android and a matched shadow on iOS.
 */
export const shadow = {
  card: {
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  glow: {
    shadowColor: '#4B3FCF',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  float: {
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
} as const;

export const font = {
  /** Unbounded — headings and the primary button. */
  display: 'Unbounded_700Bold',
  displaySemi: 'Unbounded_600SemiBold',
  /** Plus Jakarta Sans — everything else. */
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
  /** Sometype Mono — ids, timestamps, phone numbers. */
  mono: 'SometypeMono_400Regular',
  monoMedium: 'SometypeMono_500Medium',
  monoBold: 'SometypeMono_600SemiBold',
} as const;

export type ColorToken = keyof typeof color;
