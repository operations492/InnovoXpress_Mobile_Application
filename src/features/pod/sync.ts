import { AppState, Platform } from 'react-native';

import { ApiError } from '@/api/client';
import * as endpoints from '@/api/endpoints';
import { env } from '@/lib/env';
import * as outbox from './outbox';
import type { PendingProof } from './outbox';

/**
 * Sending whatever proof is waiting.
 *
 * Mirrors `features/location/tracking.ts`'s flush, including the re-drain loop,
 * because the same hazard applies: several things can ask for a flush at once —
 * the app coming to the foreground, a capture being queued, a sign-in — and two
 * concurrent passes would both read the same head of the queue and upload it
 * twice. (Twice is survivable here, since the idempotency key makes the second
 * a no-op, but it would still spend a driver's data on a duplicate 2 MB photo.)
 */

let inFlight: Promise<void> | null = null;
let flushAgain = false;

/** Called after anything is successfully sent, so the screens can refresh. */
let onSent: (() => void) | null = null;

/*
 * Retry on a timer for as long as anything is queued.
 *
 * Foreground alone is not enough, and assuming it was is a bug this cost us
 * once already: a driver who walks out of a basement with the app still open
 * generates no AppState change at all, so the queue would sit there until they
 * happened to switch apps and come back. The GPS buffer never had this problem
 * because a new fix arrives every fifteen seconds and flushes it as a side
 * effect; proof has no such heartbeat and needs its own.
 *
 * Backoff so a long outage is not a busy loop, capped at a minute so that
 * regaining signal is noticed promptly. The timer exists ONLY while the queue is
 * non-empty, so an idle app schedules nothing.
 */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;
let stopped = false;

function cancelRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

async function scheduleRetry(): Promise<void> {
  cancelRetry();
  if (stopped) return;

  // Nothing queued means nothing to come back for — let the timer die.
  if ((await outbox.size()) === 0) {
    retryStep = 0;
    return;
  }

  const delay = RETRY_DELAYS_MS[Math.min(retryStep, RETRY_DELAYS_MS.length - 1)]!;
  retryStep += 1;
  retryTimer = setTimeout(() => void flush(), delay);
}

/**
 * Is this failure worth keeping the entry for?
 *
 * The distinction matters more than anywhere else in the app, because getting it
 * wrong has two opposite and both-bad outcomes: retry a permanent rejection and
 * one entry blocks the queue forever, so every later stop stays unsent; drop a
 * temporary failure and the driver silently loses proof they believe they
 * captured.
 *
 *  - **Offline / timeout** (status 0) — keep. This is the case the queue exists
 *    for.
 *  - **5xx** — keep. The server is having a bad minute, not refusing the data.
 *  - **401** — keep. The token expired while the app sat in a pocket; the next
 *    flush runs after a refresh.
 *  - **409** — treated as SUCCESS by the caller, not as a failure: the stop is
 *    already closed, which is the outcome we wanted.
 *  - **Any other 4xx** — permanent. The server has looked at this payload and
 *    will say the same thing forever.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true; // unknown shape — assume transient
  if (error.status === 0) return true;
  if (error.status === 401) return true;
  /*
   * 408 and 429 are explicitly transient despite being 4xx.
   *
   * 429 is the one that would hurt most: a depot full of drivers reconnecting
   * after an area outage is exactly how a server starts rate-limiting, and
   * treating that as permanent would have every one of them delete the proof
   * they had just been told was safe.
   */
  if (error.status === 408 || error.status === 429) return true;
  return error.status >= 500;
}

/**
 * Give up on an entry that has failed this many times.
 *
 * Nothing retryable is retried forever. The drain is strictly oldest-first —
 * it has to be, or the server rejects a delivery for a job it believes was never
 * picked up — which means one entry that can never succeed blocks every stop
 * behind it. An unreadable file or a shape of failure nobody anticipated would
 * otherwise cost a whole day's proof rather than one stop's.
 *
 * At the capped backoff of a minute, twenty attempts is roughly twenty minutes
 * of genuine trying before anything is abandoned.
 */
const MAX_ATTEMPTS = 20;

/**
 * Upload one queued entry through the ordinary capture endpoint.
 *
 * The same call the online path makes — there is no separate "queued" API. A
 * second code path on the server side is how the offline route ends up subtly
 * different from the one everybody tests.
 */
async function send(entry: PendingProof): Promise<void> {
  const files = outbox.materialise(entry);

  if (!files) {
    // Not an upload failure — there is nothing left to upload. Thrown as a
    // permanent ApiError so the drain drops it rather than retrying forever.
    throw new ApiError(
      422,
      'FILES_MISSING',
      'The stored images for this proof are no longer on the device.',
    );
  }

  await endpoints.captureProof({
    id: entry.consignmentId,
    leg: entry.leg,
    photo: files.photo,
    signature: files.signature,
    signedByName: entry.signedByName,
    itemCount: entry.itemCount,
    note: entry.note,
    idempotencyKey: entry.idempotencyKey,
  });
}

/** One pass: send everything queued, oldest first, stopping at the first thing that cannot go. */
async function drain(): Promise<void> {
  for (;;) {
    // Sign-out tore the sender down mid-pass: stop before sending the departing
    // driver's proof under whatever session comes next.
    if (stopped) return;

    const entry = await outbox.peek();
    if (!entry) return;

    if (entry.attempts >= MAX_ATTEMPTS) {
      await outbox.remove(entry.id);
      console.warn(
        `[pod] giving up on ${entry.orderNo} (${entry.leg}) after ${entry.attempts} attempts — ` +
          'dropped so the rest of the queue can drain',
      );
      continue;
    }

    try {
      await send(entry);
      await outbox.remove(entry.id);
      if (__DEV__) console.log(`[pod] sent queued proof for ${entry.orderNo} (${entry.leg})`);
      onSent?.();
    } catch (e) {
      /*
       * A 409 means this stop is already closed — captured on another device, or
       * by an earlier attempt whose response was lost in a way the idempotency
       * key could not cover. The queue's job is done either way.
       */
      if (e instanceof ApiError && e.isConflict) {
        await outbox.remove(entry.id);
        if (__DEV__) console.log(`[pod] ${entry.orderNo} was already closed — dropping from queue`);
        onSent?.();
        continue;
      }

      if (!isRetryable(e)) {
        /*
         * Dropped rather than retried forever. A poison entry at the head would
         * block every proof behind it, which turns one lost stop into a lost
         * day — strictly worse than losing the one the server has already
         * refused.
         */
        await outbox.remove(entry.id);
        console.warn(
          `[pod] ${entry.orderNo} (${entry.leg}) was refused and has been dropped:`,
          e instanceof Error ? e.message : String(e),
        );
        continue;
      }

      /*
       * Stop the whole pass, do not skip to the next entry.
       *
       * Order is load-bearing: the server will not accept a delivery proof for a
       * job it still believes was never picked up, so sending out of order would
       * manufacture 409s for perfectly good entries. The queue drains strictly
       * oldest-first or not at all.
       *
       * Counted first, so an entry that keeps failing eventually hits
       * MAX_ATTEMPTS and stops holding everything else hostage.
       */
      await outbox.recordAttempt(entry.id);
      throw e;
    }
  }
}

export function flush(): Promise<void> {
  if (env.demo || Platform.OS === 'web') return Promise.resolve();
  // Torn down — a retry timer whose callback was already dispatched must not
  // start a fresh pass after sign-out.
  if (stopped) return Promise.resolve();

  if (inFlight) {
    flushAgain = true;
    return inFlight;
  }

  inFlight = (async () => {
    try {
      do {
        flushAgain = false;
        await drain();
      } while (flushAgain);

      // Drained to empty: stop retrying and start the backoff fresh, so the next
      // outage does not inherit a long delay from the last one.
      cancelRetry();
      retryStep = 0;
    } catch (e) {
      /*
       * Left queued for the next attempt. Failing underground is the normal
       * case and must never reach the driver as an error.
       *
       * Logged at warn in PRODUCTION too, not just development. A queue that
       * silently stops draining is the failure mode with no symptom — the driver
       * sees "Sending" and assumes the app is working — so the one place it can
       * be noticed is the log a crash reporter collects.
       */
      console.warn(
        `[pod] flush failed, ${await outbox.size()} proof(s) still queued —`,
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      inFlight = null;
      // Whatever happened, come back for anything still queued.
      await scheduleRetry();
    }
  })();

  return inFlight;
}

/**
 * Flush whenever the app comes back to the foreground, and once on startup.
 *
 * Foreground is the only reliable moment on iOS — background execution is
 * granted at the OS's discretion and cannot be depended on for a multi-megabyte
 * upload. It is also the right moment in practice: a driver who has come out of
 * a basement is usually looking at the phone.
 *
 * Mounted once at the root, the same way `startQueryFocusTracking` is.
 */
export function startProofSync(onFlushed?: () => void): () => void {
  if (env.demo || Platform.OS === 'web') return () => undefined;

  onSent = onFlushed ?? null;
  stopped = false;

  /*
   * Adopt orphans before the first drain.
   *
   * An unarmed entry means a screen was uploading it. Nothing can be mid-upload
   * at startup, so every unarmed survivor is a capture whose app died before the
   * request finished — precisely the loss this queue was built to prevent.
   */
  void (async () => {
    const adopted = await outbox.armOrphans();

    /*
     * After arming, so a live entry's images are never mistaken for litter.
     *
     * Sweeps files no entry refers to — what a lost or truncated index leaves
     * behind. Nothing else would ever remove them.
     */
    const swept = await outbox.sweepOrphanFiles();
    if (swept > 0) console.warn(`[pod] removed ${swept} unreferenced file(s) from the outbox`);

    if (stopped) return;

    if (__DEV__) {
      // Counted AFTER arming, or it would report the queue as empty while
      // holding a capture rescued from a killed process.
      const queued = await outbox.size();
      const rescued = adopted > 0 ? ` (${adopted} rescued from a previous run)` : '';
      console.log(`[pod] sync started — ${queued} proof(s) queued${rescued}`);
    }

    await flush();
  })();

  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    // Coming back to the foreground is a good moment to try regardless of where
    // the backoff had got to — the driver has probably just moved.
    retryStep = 0;
    void flush();
  });

  return () => {
    stopped = true;
    cancelRetry();
    retryStep = 0;
    /*
     * Cleared so a later `startProofSync` is not handed the previous session's
     * promise instead of draining. `inFlight` is module state and outlives this
     * teardown; the pass it refers to stops at its next `stopped` check.
     */
    inFlight = null;
    subscription.remove();
    onSent = null;
  };
}
