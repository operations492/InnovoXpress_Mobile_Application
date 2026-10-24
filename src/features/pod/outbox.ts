import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import type { PodLeg } from '@/api/types';
import type { UploadFile } from './capture';

/**
 * An offline queue for proof of delivery.
 *
 * A courier captures proof in exactly the places a phone has no signal:
 * basements, lifts, metal-clad loading bays. Before this, an upload that failed
 * there left the driver standing at the door with a photo, a signature and no
 * way to close the stop — the one moment in the app with no way forward.
 *
 * Deliberately built as a near-twin of `features/location/buffer.ts`, down to
 * the `exclusive` serialisation. Two queues on one phone with different failure
 * behaviour would be two things to reason about; this way, what is true of the
 * GPS buffer is true here.
 *
 * ## Why the files are copied rather than referenced
 *
 * The picker and the signature pad both write into the CACHE directory, which
 * the OS may reclaim at any time — and is especially likely to under the storage
 * pressure that a queue of unsent photos itself creates. A queued proof whose
 * files had been evicted would fail forever. So the bytes are copied somewhere
 * the OS will not touch before the entry is recorded.
 *
 * ## Why only the file NAME is stored
 *
 * An iOS app's container path changes between installs and restores, so an
 * absolute `file:///var/mobile/Containers/Data/Application/<uuid>/...` URI
 * recorded today can be dead tomorrow while the file itself is perfectly
 * present. Names are stored and resolved against `Paths.document` at the moment
 * of use, which is stable by construction.
 */

const KEY = 'ix.pod.outbox.v1';
const DIR_NAME = 'pod-outbox';

/**
 * A full day of stops for a driver who never regains signal.
 *
 * Bounded because each entry holds two images: an unbounded queue on a phone
 * that stays offline is a slow way to fill the disk. Past this the OLDEST is
 * dropped — the opposite of the GPS buffer's reasoning, where recent fixes
 * matter more, because here the oldest proof is the one whose stop is furthest
 * behind the driver and least likely to still be reconcilable.
 */
const MAX_QUEUED = 30;

/** What is kept on disk for one unsent proof. */
interface StoredFile {
  /** File NAME only — see the note on iOS container paths above. */
  file: string;
  name: string;
  type: string;
}

export interface PendingProof {
  id: string;
  consignmentId: string;
  /** Carried for display: the queue is shown before the task list can be fetched. */
  orderNo: string;
  leg: PodLeg;
  photo: StoredFile;
  signature: StoredFile;
  signedByName: string;
  itemCount: number;
  note?: string;
  /**
   * Minted when the driver opened the screen, and persisted WITH the entry.
   *
   * This is what makes the whole queue safe to retry. A replay of the same key
   * returns the stored proof with 200 rather than "already captured" with 409,
   * so an upload whose response was lost — the normal outcome on one bar — does
   * not become a stuck entry.
   */
  idempotencyKey: string;
  queuedAt: string;
  /**
   * Whether this entry is the queue's responsibility yet.
   *
   * An entry is written BEFORE the capture screen tries to upload, purely so the
   * bytes survive the app being killed mid-request. While that upload is in
   * flight the entry is not queued in any meaningful sense — nobody else should
   * send it, and no screen should describe the stop as waiting. That is `armed:
   * false`.
   *
   * It becomes armed when the upload fails in a way worth retrying, at which
   * point the queue genuinely owns it. Everything that reads the queue —
   * `peek`, `list`, `size` — sees armed entries only, which is what keeps a
   * perfectly ordinary online capture from flashing "Sending" at the driver and
   * stops the background sender racing the screen for the same stop.
   *
   * Anything found unarmed at startup is an orphan: the process that was
   * uploading it is gone, so `armOrphans` adopts it. That is the case this whole
   * mechanism exists for.
   */
  armed: boolean;
  /** Failed sends so far. Bounds how long one bad entry can block the queue. */
  attempts: number;
}

/* ------------------------------------------------------------------ storage */

function outboxDir(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

/** Resolve a stored name back to a real file, against today's container path. */
function resolve(stored: StoredFile): File {
  return new File(outboxDir(), stored.file);
}

async function readAll(): Promise<PendingProof[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingProof[]) : [];
  } catch (e) {
    /*
     * A truncated write (process killed mid-save) costs the queue rather than
     * every subsequent flush. Returning [] is the only option — the index is the
     * only record of what those files were for, so unparseable means
     * unrecoverable.
     *
     * Logged at warn, NOT behind __DEV__. The next write persists this empty
     * array, so this is the moment a driver's unsent proof is destroyed, and it
     * must not be the one event in the feature that happens in silence.
     * `sweepOrphanFiles` then clears the images it stranded.
     */
    console.warn(
      '[pod] outbox index unreadable — queued proof has been lost:',
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}

/**
 * Writes exactly what it is given.
 *
 * It deliberately does NOT enforce `MAX_QUEUED`. It used to, with a
 * `slice(-MAX_QUEUED)`, and that was a quiet disk leak and a quiet data loss at
 * the same time: entries vanished from the index while their photos stayed in
 * the documents directory forever, with nothing logged to say a stop's proof had
 * been thrown away. Trimming is a decision about losing evidence, so it is made
 * out loud, in `enqueue`, where the files can be cleaned up with it.
 */
async function writeAll(entries: PendingProof[]): Promise<void> {
  if (entries.length === 0) {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
}

/**
 * Every access runs one at a time — see the long note in
 * `features/location/buffer.ts` for what this prevents. The same read-modify-
 * write hazard applies: a flush that commits while a capture is enqueueing
 * would write back an array that never contained the new entry.
 */
let tail: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation, operation);
  tail = result.catch(() => undefined);
  return result;
}

/** Best-effort removal of an entry's files. A leftover image is harmless. */
function discard(entry: PendingProof): void {
  for (const stored of [entry.photo, entry.signature]) {
    try {
      const file = resolve(stored);
      if (file.exists) file.delete();
    } catch {
      // The directory may already be gone, or the file already removed. Neither
      // is worth failing a commit over.
    }
  }
}

/* ------------------------------------------------------------------- queue */

export interface QueueProofInput {
  consignmentId: string;
  orderNo: string;
  leg: PodLeg;
  photo: UploadFile;
  signature: UploadFile;
  signedByName: string;
  itemCount: number;
  note?: string;
  idempotencyKey: string;
}

/**
 * Take a capture off the cache and into the queue.
 *
 * The copy happens BEFORE the entry is recorded, so a failure here leaves
 * nothing queued rather than an entry pointing at files that were never
 * written. The caller is then free to discard the originals.
 */
export function enqueue(input: QueueProofInput): Promise<string> {
  return exclusive(async () => {
    const dir = outboxDir();
    if (!dir.exists) dir.create({ intermediates: true });

    /*
     * The random tail is load-bearing, not decoration.
     *
     * Without it two captures of the same consignment and leg in the same
     * millisecond produce the same two filenames, so the second overwrites the
     * first's bytes and removing either entry deletes the other's files. The
     * screen's double-tap guard reads `busy` from a state closure, so two taps
     * inside one tick both get through — this is the backstop for that.
     */
    const stamp =
      `${input.consignmentId}-${input.leg}-${Date.now()}-` +
      Math.random().toString(36).slice(2, 8);

    const store = async (source: UploadFile, kind: string): Promise<StoredFile> => {
      // The extension matters: the server reads the filename's type as well as
      // sniffing the bytes, and a name without one is treated as a plain field.
      const ext = source.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const filename = `${stamp}-${kind}.${ext}`;
      const destination = new File(dir, filename);

      if (destination.exists) destination.delete();
      await new File(source.uri).copy(destination);

      return { file: filename, name: source.name, type: source.type };
    };

    /*
     * Both files or neither.
     *
     * The photo copies first; if the signature then fails — no space, a source
     * file already reclaimed — the photo is already sitting in the documents
     * directory with no index entry to reference it, and nothing in this module
     * ever revisits files it has no entry for. Unwinding keeps a failed capture
     * from leaving megabytes behind on every attempt.
     */
    let photo: StoredFile;
    let signature: StoredFile;
    try {
      photo = await store(input.photo, 'photo');
      signature = await store(input.signature, 'signature');
    } catch (copyError) {
      for (const name of [`${stamp}-photo`, `${stamp}-signature`]) {
        for (const candidate of dir.list()) {
          if (candidate instanceof File && candidate.name.startsWith(name)) {
            try {
              candidate.delete();
            } catch {
              // Nothing further to try; the sweep at startup will find it.
            }
          }
        }
      }
      throw copyError;
    }

    const entry: PendingProof = {
      id: `${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      consignmentId: input.consignmentId,
      orderNo: input.orderNo,
      leg: input.leg,
      photo,
      signature,
      signedByName: input.signedByName,
      itemCount: input.itemCount,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      queuedAt: new Date().toISOString(),
      // Not the queue's yet — the caller is about to try uploading it itself.
      armed: false,
      attempts: 0,
    };

    /*
     * Make room, loudly.
     *
     * Reaching the cap means a driver has completed thirty stops without the
     * phone ever regaining signal, which is already a bad day — but an unbounded
     * queue of photographs on a device that never reconnects is a worse one. The
     * oldest go first: their stops are furthest behind and least likely to still
     * be reconcilable.
     *
     * Their files are deleted with them. Dropping the index entry alone would
     * leave images in the documents directory that nothing will ever look at or
     * remove again.
     */
    const existing = await readAll();
    const overflow = existing.length + 1 - MAX_QUEUED;

    /*
     * Only armed entries are eligible to be dropped.
     *
     * An unarmed one is being uploaded by a live screen right now; discarding it
     * would delete the files out from under that request and leave the screen
     * arming an id that no longer exists.
     */
    const droppable = existing.filter((e) => e.armed).slice(0, Math.max(0, overflow));

    if (droppable.length > 0) {
      for (const dropped of droppable) {
        discard(dropped);
        console.warn(
          `[pod] outbox full (${MAX_QUEUED}) — discarded unsent proof for ` +
            `${dropped.orderNo} (${dropped.leg}), captured ${dropped.queuedAt}`,
        );
      }
    }

    const droppedIds = new Set(droppable.map((e) => e.id));
    const kept = existing.filter((e) => !droppedIds.has(e.id));
    await writeAll([...kept, entry]);

    if (__DEV__) {
      console.log(
        `[pod] stashed ${entry.orderNo} (${entry.leg}) — ${kept.length + 1} in the outbox`,
      );
    }

    // Returned so a caller that goes on to upload immediately can take its own
    // entry back out again on success, rather than leaving the sender to
    // rediscover it and send it twice.
    return entry.id;
  });
}

/**
 * Turn a queued entry back into something uploadable.
 *
 * Path resolution lives here rather than in the sender, so that the iOS
 * container-path rule has exactly one place it can be got wrong. Returns null
 * when either file has gone — which is not a transient condition and must not be
 * retried: the bytes are not coming back, and an entry that can never be sent
 * would sit at the head of the queue blocking every stop behind it.
 */
export function materialise(
  entry: PendingProof,
): { photo: UploadFile; signature: UploadFile } | null {
  const photo = resolve(entry.photo);
  const signature = resolve(entry.signature);
  if (!photo.exists || !signature.exists) return null;

  return {
    photo: { uri: photo.uri, name: entry.photo.name, type: entry.photo.type },
    signature: { uri: signature.uri, name: entry.signature.name, type: entry.signature.type },
  };
}

/**
 * Hand an entry over to the queue, because the screen could not send it.
 *
 * Until this is called the entry is invisible to everything — the sender will
 * not touch it and no screen will report the stop as waiting.
 */
export function arm(id: string): Promise<boolean> {
  return exclusive(async () => {
    const all = await readAll();

    /*
     * Reports whether the entry was actually there.
     *
     * It may not be: the index can be lost to a truncated write, or cleared by a
     * sign-out racing this upload. Mapping over nothing and returning silently
     * would have the screen tell the driver "Saved — will send when you have
     * signal" about a capture that exists nowhere, which is the worst lie this
     * feature could tell.
     */
    if (!all.some((e) => e.id === id)) return false;

    await writeAll(all.map((e) => (e.id === id ? { ...e, armed: true } : e)));
    return true;
  });
}

/**
 * Entries a screen in THIS process is uploading right now.
 *
 * Empty at process start, which is the whole point: it lets `armOrphans`
 * distinguish "unarmed because somebody is uploading it" from "unarmed because
 * the process that was uploading it is gone". Without it, any second call to
 * `startProofSync` — a root remount, a sign-in after sign-out, Fast Refresh —
 * adopts a capture mid-flight, and the screen and the sender then upload the
 * same photo while the screen's cleanup deletes the files out from under the
 * sender's request.
 */
const inFlight = new Set<string>();

export function markInFlight(id: string): void {
  inFlight.add(id);
}

export function clearInFlight(id: string): void {
  inFlight.delete(id);
}

/**
 * Adopt anything left unarmed by a process that is no longer running.
 *
 * An unarmed entry means "a screen is uploading this right now". At startup that
 * cannot be true of anything — whatever was uploading died — so every survivor
 * is an orphan, and orphans are exactly what the stash exists to rescue: the app
 * was killed between writing the capture and finishing the request.
 *
 * `inFlight` is what keeps that premise honest when this runs at some moment
 * other than a cold start.
 */
export function armOrphans(): Promise<number> {
  return exclusive(async () => {
    const all = await readAll();
    const orphans = all.filter((e) => !e.armed && !inFlight.has(e.id));
    if (orphans.length === 0) return 0;

    const ids = new Set(orphans.map((e) => e.id));
    await writeAll(all.map((e) => (ids.has(e.id) ? { ...e, armed: true } : e)));
    return orphans.length;
  });
}

/**
 * Delete images in the outbox directory that no entry refers to.
 *
 * They arise when the index is lost or truncated — the files survive, the record
 * of what they were does not — and nothing else would ever remove them. Run at
 * startup, after orphans are adopted so a live entry's files are never swept.
 */
export function sweepOrphanFiles(): Promise<number> {
  return exclusive(async () => {
    const dir = outboxDir();
    if (!dir.exists) return 0;

    const referenced = new Set(
      (await readAll()).flatMap((e) => [e.photo.file, e.signature.file]),
    );

    let removed = 0;
    for (const item of dir.list()) {
      if (!(item instanceof File) || referenced.has(item.name)) continue;
      try {
        item.delete();
        removed += 1;
      } catch {
        // Locked or already gone; the next startup tries again.
      }
    }
    return removed;
  });
}

/** Count a failed send against an entry, so it cannot be retried forever. */
export function recordAttempt(id: string): Promise<void> {
  return exclusive(async () => {
    const all = await readAll();
    await writeAll(
      all.map((e) => (e.id === id ? { ...e, attempts: (e.attempts ?? 0) + 1 } : e)),
    );
  });
}

/** The oldest armed entry, ready to send. Nothing is removed until the send succeeds. */
export function peek(): Promise<PendingProof | null> {
  return exclusive(async () => (await readAll()).find((e) => e.armed) ?? null);
}

/** Drop one entry and its files — only after the server has accepted it, or refused it permanently. */
export function remove(id: string): Promise<void> {
  return exclusive(async () => {
    const all = await readAll();
    const entry = all.find((e) => e.id === id);
    if (entry) discard(entry);
    await writeAll(all.filter((e) => e.id !== id));
  });
}

/** How many stops are genuinely waiting — armed only, so an in-flight stash is not counted. */
export function size(): Promise<number> {
  return exclusive(async () => (await readAll()).filter((e) => e.armed).length);
}

/** Armed entries only: what the screens describe as waiting to send. */
export function list(): Promise<PendingProof[]> {
  return exclusive(async () => (await readAll()).filter((e) => e.armed));
}

/** Wipe the queue. Called on sign-out: the next driver must not send this one's proof. */
export function clear(): Promise<void> {
  return exclusive(async () => {
    for (const entry of await readAll()) discard(entry);
    await AsyncStorage.removeItem(KEY);
  });
}
