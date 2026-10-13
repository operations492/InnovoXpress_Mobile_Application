import { useCallback, useEffect, useState } from 'react';

import type { PodLeg } from '@/api/types';
import * as outbox from './outbox';
import type { PendingProof } from './outbox';

/**
 * Whether this stop's proof is sitting on the phone waiting to go.
 *
 * The job's status still says AT_PICKUP or AT_DELIVERY, and must: the server has
 * not accepted the proof, so claiming otherwise would put a delivery on
 * dispatch's board that nobody can see evidence for. But the DRIVER has
 * finished the stop, and an app that shows no sign of it invites them to
 * capture the whole thing a second time.
 *
 * So the status is left alone and this answers the different question the screen
 * actually needs: is there already proof for this leg, captured and waiting?
 *
 * Polled rather than subscribed, like the queue depth on the More tab — the
 * outbox lives in AsyncStorage and on disk, not in React, so there is nothing to
 * derive during a render and no event to listen for. Three seconds is well
 * inside human reaction time for a queue that changes only when the driver
 * captures something or the signal returns.
 */
/**
 * Which jobs have proof waiting, as a set of consignment ids.
 *
 * One poll for the whole list. The per-row alternative — every card calling
 * `usePendingProof` — would read the queue once per visible card every three
 * seconds, which on a scrolling list is a lot of disk for one boolean.
 */
export function usePendingProofIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const all = await outbox.list();
      if (!active) return;
      setIds((previous) => {
        const next = new Set(all.map((e) => e.consignmentId));
        // Same contents means the same object, so every card memoised on this
        // set keeps its identity and the list does not re-render on a tick.
        if (next.size === previous.size && [...next].every((id) => previous.has(id))) {
          return previous;
        }
        return next;
      });
    };

    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return ids;
}

export function usePendingProof(consignmentId: string | undefined, leg?: PodLeg) {
  const [pending, setPending] = useState<PendingProof | null>(null);

  const refresh = useCallback(async () => {
    if (!consignmentId) {
      setPending(null);
      return;
    }

    const all = await outbox.list();
    setPending(
      all.find((e) => e.consignmentId === consignmentId && (!leg || e.leg === leg)) ?? null,
    );
  }, [consignmentId, leg]);

  useEffect(() => {
    // Same reasoning as the queue-depth poll in `app/(tabs)/more.tsx`: `refresh`
    // awaits before it sets anything, so the state change lands in a later tick
    // and cannot cascade the render this effect belongs to.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: setState runs after an await, not during this render
    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return pending;
}
