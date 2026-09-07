import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * Whether this device is in a state where the driver can actually be tracked.
 *
 * Three separate things have to be true, and they fail in different ways, so
 * they are reported separately rather than as one boolean:
 *
 *  - the OS location service is switched on at all (a device-wide setting);
 *  - this app is allowed to read position while in use;
 *  - this app is allowed to keep reading it in the background.
 *
 * Only the first two are blocking. Background permission is what keeps dispatch
 * updated with the screen off, but a driver who has granted "while using" can
 * still work — refusing to open the app over it would be punishing them for a
 * choice the OS presents separately, and on Android 11+ cannot even be asked for
 * in the same breath.
 */

export type LocationStatus =
  /** Still reading the current state; show nothing rather than a wrong prompt. */
  | 'checking'
  /** Device location is switched off entirely. No permission can substitute. */
  | 'services-off'
  /** Never asked, or asked and dismissed. The OS will still show a dialog. */
  | 'denied'
  /** Refused permanently. Only the Settings app can undo this. */
  | 'blocked'
  /** Good enough to work: services on, foreground granted. */
  | 'ready';

export interface LocationReadiness {
  status: LocationStatus;
  /** Granted separately, and only advisory — see the note above. */
  background: boolean;
  /** Run the whole prompt sequence. Safe to call repeatedly. */
  request: () => Promise<void>;
  /** Re-read the current state without prompting. */
  refresh: () => Promise<void>;
  /** Send the driver to the one place a `blocked` state can be undone. */
  openSettings: () => void;
  /** True while a prompt sequence is in flight, so the button can be disabled. */
  requesting: boolean;
}

async function read(): Promise<{ status: LocationStatus; background: boolean }> {
  const services = await Location.hasServicesEnabledAsync();
  const fg = await Location.getForegroundPermissionsAsync();

  // Asked in this order deliberately: with location switched off device-wide, a
  // granted permission still yields nothing, so that is the fault worth naming.
  if (!services) return { status: 'services-off', background: false };
  if (!fg.granted) {
    return { status: fg.canAskAgain ? 'denied' : 'blocked', background: false };
  }

  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return { status: 'ready', background: bg?.granted ?? false };
}

export function useLocationReadiness(enabled: boolean): LocationReadiness {
  const [status, setStatus] = useState<LocationStatus>('checking');
  const [background, setBackground] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const next = await read().catch(() => ({ status: 'denied' as const, background: false }));
    if (!mounted.current) return;
    setStatus(next.status);
    setBackground(next.background);
  }, [enabled]);

  const request = useCallback(async () => {
    if (!enabled || requesting) return;
    setRequesting(true);
    try {
      /*
       * Android can turn its own location service back on without leaving the
       * app — this is the system dialog every ride-hailing app shows. iOS has no
       * equivalent: the switch lives in Settings and the user must go there.
       */
      if (Platform.OS === 'android' && !(await Location.hasServicesEnabledAsync())) {
        await Location.enableNetworkProviderAsync().catch(() => undefined);
      }

      const fg = await Location.requestForegroundPermissionsAsync();

      /*
       * Only ask for background AFTER foreground is granted. iOS refuses to show
       * the "Always" prompt otherwise, and Android 11+ opens Settings rather than
       * a dialog — asking too early burns the one chance either platform gives.
       */
      if (fg.granted) {
        await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
      }
    } finally {
      if (mounted.current) setRequesting(false);
      await refresh();
    }
  }, [enabled, requesting, refresh]);

  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  /**
   * Re-check on every return to the foreground.
   *
   * Both blocking states are fixed OUTSIDE this app — in Settings, or in the
   * pull-down location toggle — and nothing notifies us when they are. Without
   * this the driver fixes the problem, comes back, and still faces the wall.
   */
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [enabled, refresh]);

  /**
   * …and poll, because the foreground event is not enough.
   *
   * Android's quick-settings shade does not reliably background the app, so a
   * driver can switch location off with the app still open and in the
   * foreground — no AppState change, no re-check, and the app carries on as if
   * it were still being tracked. That is the worst of the failure modes: it
   * looks like everything is fine while dispatch is being told a position that
   * is no longer being measured.
   *
   * Neither Android nor iOS offers a "location services changed" callback to
   * subscribe to, so asking is the only option. `hasServicesEnabledAsync` is a
   * cheap synchronous-ish platform read, and three seconds is fast enough that
   * the wall appears while the driver's thumb is still on the toggle.
   */
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return { status, background, request, refresh, openSettings, requesting };
}
