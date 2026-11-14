import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { useMe, useSetShift } from '@/features/tasks/queries';
import * as tracking from '@/features/location/tracking';
import { useAuth } from './AuthProvider';

/**
 * Shift state — derived, never chosen.
 *
 * There is no switch. Opening the app opens the shift and signing out closes it,
 * because a toggle somebody forgets to flip is indistinguishable from a driver
 * who is simply not moving, and dispatch cannot act on that ambiguity. GPS
 * reporting follows the session on the same reasoning.
 *
 * `onShift` is the server's field, not a local flag — an admin deactivating a
 * driver, or the 04:00 pg_cron job closing an abandoned shift, both change it
 * behind the app's back. So the API is the source of truth and this provider
 * makes the device agree with it.
 */

/**
 * How often to re-attempt the clock-on while it has not taken.
 *
 * Fifteen seconds is the same beat the location service reports on, so a phone
 * that has just regained signal rejoins the dispatch map and the shift at
 * roughly the same moment rather than one lagging the other.
 */
const CLOCK_ON_RETRY_MS = 15_000;

interface ShiftValue {
  onShift: boolean;
  /** True while the clock-on call is in flight, so the pill can say "Starting…". */
  busy: boolean;
  /** The device is genuinely reporting, as opposed to merely being marked on shift. */
  tracking: boolean;
  driverName: string | null;
}

const ShiftContext = createContext<ShiftValue | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { data: me } = useMe(Boolean(session));
  const setShift = useSetShift();
  const [isTracking, setIsTracking] = useState(false);

  const onShift = me?.driver?.onShift ?? false;
  const syncing = useRef(false);

  const refreshTrackingState = useCallback(async () => {
    setIsTracking(await tracking.isTracking());
  }, []);

  /**
   * Reporting follows the SESSION, not the shift.
   *
   * A driver signed into this app is a driver being tracked — clocking off ends
   * their availability for work, not the reporting. That removes the failure the
   * old design kept producing: tracking was something a person had to remember
   * to switch on, and a forgotten toggle looked exactly like a driver sitting
   * still, so dispatch could not tell "not working" from "not reporting".
   *
   * Permissions are not requested here. `LocationGate` refuses to render the app
   * without them, so by the time this runs they are granted — and re-asking
   * would spend the one prompt the OS allows on a question already answered.
   *
   * `start()` is idempotent: it returns immediately when the running service
   * matches the current settings and restarts it when it does not, which is what
   * repairs a service left over from an older configuration.
   */
  useEffect(() => {
    if (syncing.current) return;

    syncing.current = true;
    void (async () => {
      try {
        if (!session) {
          // Signed out: stop immediately. Nobody to report to, and continuing
          // to read a former user's position would be indefensible.
          await tracking.stop();
          return;
        }
        if (!me) return;
        await tracking.start();
      } catch {
        // Never let a permissions edge case take the app down at launch.
      } finally {
        syncing.current = false;
        await refreshTrackingState();
      }
    })();
  }, [session, me, refreshTrackingState]);

  /**
   * Opening the app puts the driver on shift.
   *
   * Using the app IS the shift — that is the whole point of the change. The
   * server only lists drivers whose `onShift` is true, so without this a driver
   * would be tracked, reporting perfectly, and still absent from the dispatch
   * map: the exact confusion the manual toggle used to cause, moved one step
   * later.
   *
   * It re-asserts rather than firing once. With no switch to fall back on, an
   * off-shift driver with the app open is simply broken, so every route back to
   * `onShift === false` has to correct itself: a failed call at launch, and the
   * 04:00 job closing the shift of someone still working through it.
   *
   * The ref below stops two calls overlapping — it does NOT stop a retry. `me`
   * is the clock: it refetches on focus, on reconnect and past fifteen seconds
   * of staleness, which recovers quickly and is nowhere near often enough to be
   * a storm.
   */
  const clockingOn = useRef(false);

  /*
   * Narrowed deps, so the retry timer below is not restarted constantly.
   *
   * `me` is a new object on every refetch and `setShift` on every render, so
   * depending on either would tear down and rebuild the interval before it ever
   * fired — the timer would exist and never tick. `mutateAsync` is stable in
   * TanStack v5, and the only thing about `me` this effect cares about is
   * whether a driver record exists at all.
   */
  const hasDriver = Boolean(me?.driver);
  const clockOn = setShift.mutateAsync;

  useEffect(() => {
    // A login with no driver record has no shift to open.
    if (!session || !hasDriver || onShift) return;

    let cancelled = false;

    const attempt = async () => {
      // Guards overlapping calls only, NOT trying again.
      if (cancelled || clockingOn.current) return;

      clockingOn.current = true;
      try {
        await clockOn(true);
        void tracking.reportNow();
      } catch {
        // Offline at launch is normal and there is no manual switch to fall
        // back on, so failure is not final — the interval below tries again.
      } finally {
        clockingOn.current = false;
      }
    };

    void attempt();

    /*
     * Its own clock, rather than riding on `me` refetching.
     *
     * That was the previous arrangement and it left drivers stuck off shift:
     * `me` refetches on focus, on reconnect, or past its staleTime — but
     * `onlineManager` is not wired to any network source in this app, so there
     * is no reconnect event on a phone, and an app left in the FOREGROUND never
     * changes focus either. A driver who launched with no signal and then got
     * it back stayed off shift, invisible to dispatch, until they happened to
     * switch away from the app and back.
     *
     * Cheap to leave running: it only exists while off shift, which with this
     * in place is a few seconds at launch and otherwise never.
     */
    const timer = setInterval(() => void attempt(), CLOCK_ON_RETRY_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, hasDriver, onShift, clockOn]);

  /** Flush the offline queue whenever the driver comes back to the app. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void tracking.flush();
      void refreshTrackingState();
    });
    return () => sub.remove();
  }, [refreshTrackingState]);

  const value = useMemo<ShiftValue>(
    () => ({
      onShift,
      busy: setShift.isPending,
      tracking: isTracking,
      driverName: me?.driver?.name ?? me?.name ?? null,
    }),
    [onShift, setShift.isPending, isTracking, me],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift(): ShiftValue {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error('useShift must be used inside <ShiftProvider>');
  return ctx;
}
