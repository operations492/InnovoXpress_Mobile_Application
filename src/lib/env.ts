import Constants from 'expo-constants';

/**
 * Runtime configuration.
 *
 * Expo inlines every `EXPO_PUBLIC_*` variable at build time, so these are plain
 * string literals by the time the app runs — `process.env.EXPO_PUBLIC_X` cannot
 * be indexed dynamically, which is why each one is spelled out.
 */

/** Empty, whitespace, or a `<placeholder>` left over from .env.example — all "unset". */
function clean(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  return trimmed.replace(/\/+$/, '');
}

/**
 * How often the shift tracker reports.
 *
 * Constants, not configuration. Neither of these is a per-deployment choice —
 * they are a contract with the backend, and exposing them as environment
 * variables only ever produced a way to break that contract from a text file:
 *
 *  - The interval must stay well under the server's POSITION_LIVE_SECONDS (120)
 *    or a driver goes stale between reports.
 *  - The distance filter must be 0. Anything else is a hard gate — Android
 *    delivers NOTHING until the phone has moved that far, so a driver waiting at
 *    a dock stops reporting and drops off the dispatch map, with the GPS
 *    indicator and shift notification still showing. That is not a tuning knob,
 *    it is a bug with a dial on it, and it cost real time to find.
 *
 * Thinning belongs on the server, which already does it: the live position is
 * overwritten on every batch, and only fixes more than HISTORY_MIN_MOVE_M (15 m)
 * apart reach the trail. Reporting on the timer costs one row per parked hour.
 */
const LOCATION_INTERVAL_MS = 15_000;
const LOCATION_DISTANCE_M = 0;

/** The API listens here; only the host in front of it moves. */
const DEV_API_PORT = 4000;

/**
 * Work out the API host from the one the phone is provably already talking to.
 *
 * A hardcoded LAN address is wrong the moment the router hands out a different
 * lease — which it does, routinely. The symptom is not obvious either: the
 * requests fail with `NoRouteToHostException`, which reads like the server is
 * down rather than like the address is stale.
 *
 * Metro's host cannot be stale by definition: the JavaScript now running was
 * downloaded from it seconds ago. `hostUri` is `"192.168.0.102:8081"`, so taking
 * the host and pointing it at the API port follows the machine automatically.
 *
 * Dev only. A release build has no Metro, so a real deployment must set
 * `EXPO_PUBLIC_API_URL` — and an explicit value always wins over this anyway.
 */
function apiUrlFromMetro(): string | null {
  if (!__DEV__) return null;

  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0]?.trim();
  if (!host) return null;

  return `http://${host}:${DEV_API_PORT}`;
}

// Explicit configuration always wins: point it at a staging URL, a tunnel, or a
// machine that is not the one serving the bundle, and that is what gets used.
const apiUrl = clean(process.env.EXPO_PUBLIC_API_URL) ?? apiUrlFromMetro();
const supabaseUrl = clean(process.env.EXPO_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Demo mode — the app runs entirely on fixtures, with no API and no Supabase.
 *
 * It turns itself on when the credentials are absent rather than throwing,
 * because the alternative is an app that cannot be opened at all until someone
 * has a database. Reviewing the design should not require infrastructure.
 *
 * To demo deliberately, blank the two Supabase values. There was once a separate
 * override variable for this, but it did the same job as leaving the credentials
 * out and was one more thing to keep in sync.
 *
 * It is deliberately loud: a banner sits across the top of every screen, because
 * a fixture that looks like real work is how someone ends up believing a parcel
 * was delivered.
 */
export const demo = !supabaseUrl || !supabaseAnonKey || !apiUrl;

export const env = {
  demo,
  /** Shown on the More tab. Meaningless in demo mode, hence the label. */
  apiUrl: apiUrl ?? 'demo — no server',
  supabaseUrl: supabaseUrl ?? '',
  supabaseAnonKey: supabaseAnonKey ?? '',
  /** See the constants above — fixed by the backend contract, not configurable. */
  locationIntervalMs: LOCATION_INTERVAL_MS,
  locationDistanceM: LOCATION_DISTANCE_M,
} as const;
