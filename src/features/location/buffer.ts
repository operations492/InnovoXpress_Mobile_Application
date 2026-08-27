import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationPing } from '@/api/types';

/**
 * An offline queue for GPS fixes.
 *
 * A courier spends real time in underground loading bays and dead-spot
 * warehouses. Dropping fixes taken there would leave holes in the trail exactly
 * where dispatch most wants to see one, so they are written to disk and flushed
 * when the signal returns.
 *
 * AsyncStorage, not SecureStore: this is a few hundred coordinates, it is not a
 * credential, and SecureStore's per-item size limit makes it the wrong tool.
 */

const KEY = 'ix.location.buffer.v1';
const ACTIVE_KEY = 'ix.location.activeConsignment.v1';

/** The API accepts at most 200 pings per request. */
export const MAX_BATCH = 200;

/**
 * Roughly three hours of fixes at the default 15s cadence. Past that the oldest
 * are dropped: a trail from this morning is worth less than a working app, and
 * an unbounded queue on a phone that never reconnects is a slow leak.
 */
const MAX_BUFFERED = 2_000;

async function readAll(): Promise<LocationPing[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocationPing[]) : [];
  } catch {
    // A truncated write (process killed mid-save) should cost the trail, not the
    // shift — start clean rather than throwing on every subsequent flush.
    return [];
  }
}

async function writeAll(pings: LocationPing[]): Promise<void> {
  if (pings.length === 0) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(pings.slice(-MAX_BUFFERED)));
}

/**
 * Every access to the queue runs one at a time.
 *
 * This is not belt-and-braces — without it the queue silently eats fixes.
 * `enqueue` is a read-modify-write with an `await` between the read and the
 * write, and the OS does not deliver locations one at a time: after the app has
 * been backgrounded it hands the task a whole batch at once, as dozens of
 * separate callbacks in a single tick. Each one read the same pre-burst array,
 * appended its own ping, and wrote it back — so the last writer won and every
 * other fix was destroyed. Twenty-nine locations arrived and one survived.
 *
 * The visible damage was worse than losing points off a trail: the survivor was
 * whichever callback happened to write last, usually an old fix, so the position
 * that reached the server was already outside its liveness window and the driver
 * never appeared on the map at all.
 *
 * `commit` races `enqueue` the same way — it rewrites the whole array too, so a
 * fix arriving mid-commit vanishes with it.
 *
 * A promise chain is enough: this is one JavaScript thread, the operations are
 * short, and ordering is exactly what was missing.
 */
let tail: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  // Chained off both outcomes: one failed write must not wedge the queue shut.
  const result = tail.then(operation, operation);
  tail = result.catch(() => undefined);
  return result;
}

export function enqueue(pings: LocationPing[]): Promise<void> {
  if (pings.length === 0) return Promise.resolve();
  return exclusive(async () => {
    const existing = await readAll();
    await writeAll([...existing, ...pings]);
  });
}

/** The oldest batch, ready to send. Nothing is removed until the send succeeds. */
export function peekBatch(): Promise<LocationPing[]> {
  // Serialised with the writers so it cannot read a half-updated queue and hand
  // back pings that a concurrent commit is in the middle of dropping.
  return exclusive(async () => (await readAll()).slice(0, MAX_BATCH));
}

/** Drop the first `count` pings — call this only after the server has accepted them. */
export function commit(count: number): Promise<void> {
  return exclusive(async () => {
    const all = await readAll();
    await writeAll(all.slice(count));
  });
}

export function size(): Promise<number> {
  return exclusive(async () => (await readAll()).length);
}

export function clear(): Promise<void> {
  return exclusive(() => AsyncStorage.removeItem(KEY));
}

/**
 * The job the driver currently has open, so a fix can be attributed to it.
 * Stored rather than passed because the background task has no React context.
 */
export async function setActiveConsignment(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(ACTIVE_KEY, id);
  else await AsyncStorage.removeItem(ACTIVE_KEY);
}

export async function getActiveConsignment(): Promise<string | undefined> {
  return (await AsyncStorage.getItem(ACTIVE_KEY)) ?? undefined;
}
