import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { recordLocations } from '@/api/endpoints';
import type { LocationPing } from '@/api/types';
import { env } from '@/lib/env';
import * as buffer from './buffer';

/**
 * Position reporting, tied to the SESSION and to nothing else.
 *
 * The rule the backend cares about: a driver counts as live for
 * POSITION_LIVE_SECONDS (120 by default) since their last fix, and the live
 * position is overwritten unconditionally while history keeps only real
 * movement. So reporting often is cheap — the server does the filtering — and
 * reporting rarely makes a parked courier disappear from the dispatch map.
 *
 * Signed out, nothing runs — the service is stopped the moment the session ends.
 * While signed in it reports continuously; `onShift` decides whether dispatch is
 * shown the driver, not whether the phone reports.
 */

export const LOCATION_TASK = 'ix-shift-location';

/**
 * Demo mode reports nothing.
 *
 * There is no server to receive a fix, and asking a reviewer for
 * "allow all the time" location just to look at the design would be the app
 * taking something it has no use for. The flag below only keeps the shift pill
 * honest about what it is showing.
 */
let demoTracking = false;

function toPing(l: Location.LocationObject, consignmentId?: string): LocationPing {
  return {
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    // The schema rejects a negative accuracy, and both fields are -1 on some
    // Android devices when the sensor has no estimate.
    ...(typeof l.coords.accuracy === 'number' && l.coords.accuracy >= 0
      ? { accuracyM: l.coords.accuracy }
      : {}),
    ...(typeof l.coords.speed === 'number' && l.coords.speed >= 0
      ? { speedMps: Math.min(l.coords.speed, 200) }
      : {}),
    ...(typeof l.coords.heading === 'number' && l.coords.heading >= 0
      ? { headingDeg: Math.min(l.coords.heading, 360) }
      : {}),
    ...(consignmentId ? { consignmentId } : {}),
    recordedAt: new Date(l.timestamp).toISOString(),
  };
}

/**
 * Defined at module scope, and this module is imported by the root layout, so the
 * task is registered before the OS can deliver to it. Registering it inside a
 * component would mean a cold background wake-up finds no handler and the fix is
 * lost.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    // Worth seeing: the OS reports permission revocation and provider failures
    // here, and swallowing them is why "tracking stopped" looks like a mystery.
    if (__DEV__) console.warn('[loc] task error —', String(error.message ?? error));
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  if (__DEV__) {
    const newest = locations[locations.length - 1]!;
    const ageS = Math.round((Date.now() - newest.timestamp) / 1000);
    console.log(`[loc] ${locations.length} fix(es) delivered, newest is ${ageS}s old`);
  }

  const consignmentId = await buffer.getActiveConsignment();
  await buffer.enqueue(locations.map((l) => toPing(l, consignmentId)));
  await flush();
});

/**
 * Send whatever is queued, oldest first.
 *
 * Serialised by a module-level promise: a foreground timer, an app-resume and a
 * background fix can all land at once, and two concurrent flushes would send the
 * same batch twice and then commit it twice, eating fixes that were never sent.
 */
let inFlight: Promise<void> | null = null;

/**
 * Set when a flush is asked for while one is already running.
 *
 * Without it, a BURST of fixes uploads exactly one ping. The OS hands the task
 * a hundred queued locations in a single tick; each callback awaits
 * `buffer.enqueue` — which yields to AsyncStorage — so the first flush starts
 * while the buffer still holds one item, drains that, sees an empty buffer and
 * exits. The other ninety-nine callbacks meanwhile received the promise of that
 * finished flush and are satisfied by it, so nothing sends their pings.
 *
 * The one ping that did go was the OLDEST in the queue, minutes outside the
 * server's liveness window, so the driver stayed invisible while the buffer grew.
 */
let flushAgain = false;

/** One pass: send everything queued, oldest first, in batches the API accepts. */
async function drain(): Promise<void> {
  for (;;) {
    const batch = await buffer.peekBatch();
    if (batch.length === 0) return;

    await recordLocations(batch);
    await buffer.commit(batch.length);
    if (__DEV__) console.log(`[loc] sent ${batch.length} ping(s)`);

    // A short batch means the queue is empty; a full one means there is more.
    if (batch.length < buffer.MAX_BATCH) return;
  }
}

export function flush(): Promise<void> {
  if (env.demo) return Promise.resolve();
  if (inFlight) {
    flushAgain = true;
    return inFlight;
  }

  inFlight = (async () => {
    try {
      // Re-drain while anything asked for a flush during the pass above: those
      // callers were handed this promise and will not ask a second time.
      do {
        flushAgain = false;
        await drain();
      } while (flushAgain);
    } catch (e) {
      // Left in the buffer for the next attempt. A failed flush is the normal
      // case underground and must never surface as an error to the driver — but
      // silence here is also how a permanent upload failure hides behind a
      // still-running GPS indicator, so say so where a developer can see it.
      if (__DEV__) {
        console.warn(
          `[loc] flush failed, ${await buffer.size()} ping(s) still queued —`,
          e instanceof Error ? e.message : String(e),
        );
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/*
 * Permissions are NOT requested here.
 *
 * `features/location/readiness.ts` owns that, and `LocationGate` will not render
 * the app until it is satisfied — so anything calling `start()` below can assume
 * the grant already exists. Two modules asking independently is how an app burns
 * the single prompt each platform allows on a question already answered, and how
 * the two answers drift apart.
 */

export async function isTracking(): Promise<boolean> {
  if (env.demo) return demoTracking;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/**
 * What the running service was started with.
 *
 * `startLocationUpdatesAsync` freezes its options into a native service that
 * outlives the JavaScript entirely: `killServiceOnDestroy: false` keeps it alive
 * across a reload, a force-quit and a crash, and `start()` below sees
 * `isTracking() === true` and leaves it alone. So changing an option in this
 * file — or in `.env` — has NO effect on a driver who is already on shift,
 * however many times they restart the app. The only thing that ever applied it
 * was clocking off and on again, which is not something anyone should have to
 * know.
 *
 * Recording the options the service was started with turns that into something
 * the app can notice and correct by itself.
 */
const OPTIONS_KEY = 'ix.location.options.v1';

/** Only the options that change how often a fix arrives need comparing. */
function optionsSignature(): string {
  return `${env.locationIntervalMs}:${env.locationDistanceM}`;
}

/**
 * A fix we ask for, on a timer, instead of waiting to be given one.
 *
 * Two things make passive updates alone insufficient, and both were measured:
 *
 *  - The OS delivers fixes that are ALREADY 25-40 seconds old. The server judges
 *    liveness on the device's own `recordedAt`, so that staleness is spent
 *    before the ping is even sent, against a 120-second window.
 *  - Delivery stops entirely while the phone is idle. Android holds the fixes
 *    and replays them on resume, by which point they are minutes old and the
 *    driver has long since dropped off the map.
 *
 * `getCurrentPositionAsync` is a request rather than a subscription: it returns a
 * fix stamped now. Every beat therefore refreshes `recordedAt` regardless of what
 * the background task has or has not been handed.
 *
 * 45s is chosen against the server's 120s window: two beats can be missed
 * entirely before a driver goes stale.
 */
const HEARTBEAT_MS = 45_000;

let heartbeat: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    void reportNow();
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (!heartbeat) return;
  clearInterval(heartbeat);
  heartbeat = null;
}

export async function start(): Promise<void> {
  if (env.demo) {
    demoTracking = true;
    return;
  }

  if (await isTracking()) {
    const running = await AsyncStorage.getItem(OPTIONS_KEY).catch(() => null);
    if (running === optionsSignature()) {
      // Already correct — but the heartbeat lives in JS, so a reload leaves the
      // service running with no timer behind it. Restart it either way.
      startHeartbeat();
      return;
    }

    // Stale service from a previous configuration. Restart it, or the driver
    // keeps reporting on the old settings until they next clock off.
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }

  await AsyncStorage.setItem(OPTIONS_KEY, optionsSignature()).catch(() => undefined);

  if (__DEV__) {
    console.log(
      `[loc] starting service — every ${env.locationIntervalMs}ms, distance filter ${env.locationDistanceM}m, api ${env.apiUrl}`,
    );
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: env.locationIntervalMs,
    /*
     * 0 = no displacement filter, report on the timer alone.
     *
     * Anything above 0 is a gate, not a hint: the OS withholds every fix until
     * the phone has moved that far, so a driver parked at a dock reports
     * nothing, goes stale after POSITION_LIVE_SECONDS and vanishes from the
     * dispatch map — with the GPS indicator and the shift notification still
     * showing, because updates remain requested. The server keeps the trail
     * clean itself (HISTORY_MIN_MOVE_M), so there is nothing for the client to
     * filter.
     */
    distanceInterval: env.locationDistanceM,
    // iOS-only, and unrelated to the above: stops CoreLocation suspending
    // updates when it decides the device has settled. Android's filtering is
    // `distanceInterval` and nothing else.
    pausesUpdatesAutomatically: false,
    ...(Platform.OS === 'android'
      ? {
          // Android 10+ kills background location without a visible service.
          // The notification is the OS's honesty requirement, and ours too.
          foregroundService: {
            notificationTitle: 'Innovo Xpress — on shift',
            notificationBody: 'Sharing your position with dispatch until you clock off.',
            notificationColor: '#4B3FCF',
            killServiceOnDestroy: false,
          },
        }
      : { activityType: Location.ActivityType.AutomotiveNavigation, showsBackgroundLocationIndicator: true }),
  });

  startHeartbeat();
}

export async function stop(): Promise<void> {
  stopHeartbeat();

  if (env.demo) {
    demoTracking = false;
    return;
  }
  if (await isTracking()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  // Forget what the service was started with, so the next clock-on always
  // configures a fresh one rather than trusting a signature with no service.
  await AsyncStorage.removeItem(OPTIONS_KEY).catch(() => undefined);
  // Send what is left before going quiet — those fixes were taken on shift and
  // dispatch is entitled to them.
  await flush();
}

/** One immediate fix, so clocking on puts the driver on the map without waiting. */
export async function reportNow(): Promise<void> {
  if (env.demo) return;
  try {
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    if (__DEV__) {
      const ageS = Math.round((Date.now() - current.timestamp) / 1000);
      console.log(`[loc] heartbeat fix, ${ageS}s old`);
    }
    const consignmentId = await buffer.getActiveConsignment();
    await buffer.enqueue([toPing(current, consignmentId)]);
    await flush();
  } catch (e) {
    // No fix yet (cold GPS, indoors). The periodic updates will cover it.
    if (__DEV__) {
      console.warn('[loc] heartbeat failed —', e instanceof Error ? e.message : String(e));
    }
  }
}
