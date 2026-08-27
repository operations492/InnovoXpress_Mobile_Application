import { useSyncExternalStore } from 'react';

/**
 * One ticking clock for the whole app.
 *
 * "Is this stop overdue?" is a question about wall-clock time, so answering it
 * with `Date.now()` in a render body is both impure — React may render twice and
 * get two answers — and quietly wrong: nothing re-renders when the deadline
 * passes, so a late job keeps looking on-time until something else happens to
 * refresh the list.
 *
 * `useSyncExternalStore` fixes both. Render reads a snapshot rather than calling
 * an impure function, and every subscriber re-renders together when the snapshot
 * moves. A single module-level interval serves all of them, so a list of fifty
 * task cards still costs exactly one timer.
 *
 * The tick is coarse on purpose. Nothing here shows seconds — the finest thing
 * on screen is "in 4 min" — so a 30-second beat is under half the smallest unit
 * anyone can see, and the timer stays cheap enough to leave running.
 */

const TICK_MS = 30_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Started with the first subscriber and stopped with the last, so the timer
  // never outlives the UI that needs it.
  timer ??= setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, TICK_MS);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * The current time, as a value that render is allowed to read.
 *
 * Re-renders the caller every {@link TICK_MS}. Use it for anything compared
 * against the clock — deadlines, staleness, "how long ago" — and not for
 * timestamps that came from the server, which are already fixed.
 */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    // Server rendering has no clock to read; the first client tick corrects it.
    () => now,
  );
}
