import { useCallback, useEffect, useState } from 'react';

import * as endpoints from '@/api/endpoints';
import type { OrderDocument, PodLeg, StopDocuments } from '@/api/types';
import * as outbox from './outbox';

/**
 * The paperwork for one stop, and what is still unsigned there.
 *
 * Not a TanStack query, deliberately. Every `url` in the response is a signed
 * link that expires within minutes, so a cached list is a list of dead links —
 * the opposite of what a cache is for. This fetches once when the screen opens
 * and again whenever a signature lands, which is exactly when the contents
 * change.
 */

/** Does this document have to be signed at this stop? */
export function mustSignHere(doc: OrderDocument, leg: PodLeg): boolean {
  return leg === 'PICKUP' ? doc.signAtPickup : doc.signAtDelivery;
}

/** Has it been signed here already, according to the server? */
export function signedHere(doc: OrderDocument, leg: PodLeg): boolean {
  return doc.signatures.some((s) => s.leg === leg);
}

export interface StopPaperwork {
  documents: OrderDocument[];
  /**
   * Documents that must be signed here and are not yet — counting a signature
   * sitting in the outbox as done.
   *
   * That last part matters offline: the driver captured the signature, it is on
   * the device, and refusing to let them finish the stop over a request that has
   * not left the phone would strand them at the door. The server checks again on
   * arrival and is the real gate; this one only decides what the button does.
   */
  outstanding: OrderDocument[];
  loading: boolean;
  error: unknown;
  /** Signatures captured here that are still queued on the device. */
  queuedKinds: Set<string>;
  refresh: () => Promise<void>;
}

export function useStopPaperwork(
  consignmentId: string | undefined,
  leg: PodLeg,
  enabled: boolean,
): StopPaperwork {
  const [data, setData] = useState<StopDocuments | null>(null);
  const [queuedKinds, setQueuedKinds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!consignmentId || !enabled) return;

    setLoading(true);
    try {
      const [fresh, queued] = await Promise.all([
        endpoints.getStopDocuments(consignmentId, leg),
        outbox.list(),
      ]);
      setData(fresh);
      setQueuedKinds(
        new Set(
          queued
            .filter((e) => !outbox.isProof(e) && e.consignmentId === consignmentId && e.leg === leg)
            .map((e) => (outbox.isProof(e) ? '' : e.document)),
        ),
      );
      setError(null);
    } catch (e) {
      /*
       * Keep whatever was already on screen.
       *
       * A driver who opened this with signal and lost it at the door still needs
       * to see which documents they were told to get signed. Replacing the list
       * with an error would take that away at the worst moment.
       */
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [consignmentId, leg, enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: setState runs after an await
    void refresh();
  }, [refresh]);

  const documents = data?.documents ?? [];

  return {
    documents,
    outstanding: documents.filter(
      (d) => mustSignHere(d, leg) && !signedHere(d, leg) && !queuedKinds.has(d.kind),
    ),
    loading,
    error,
    queuedKinds,
    refresh,
  };
}
