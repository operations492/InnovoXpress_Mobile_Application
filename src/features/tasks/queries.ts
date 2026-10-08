import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import * as endpoints from '@/api/endpoints';
import type { ManualStatus, PodLeg, TaskDetail } from '@/api/types';
import type { UploadFile } from '@/features/pod/capture';

/**
 * Query keys, in one place so an invalidation can never miss a screen.
 *
 * `tasks` is keyed WITHOUT `includeDelivered` at its root so that finishing a job
 * invalidates both the active list and the history list in one call — they are
 * two views of the same server-side collection.
 */
export const keys = {
  me: ['me'] as const,
  tasks: ['tasks'] as const,
  /**
   * Nested UNDER `tasks`, so invalidating the run invalidates history too.
   *
   * That is wanted, not incidental: capturing proof is the one event that moves
   * a job out of the run and into the archive, and `useCaptureProof` invalidates
   * `tasks`. Keeping history outside that prefix would leave a delivered job
   * absent from both lists until something else happened to refetch.
   */
  history: ['tasks', 'history'] as const,
  taskList: (includeDelivered: boolean) => ['tasks', { includeDelivered }] as const,
  task: (id: string) => ['task', id] as const,
  pod: (id: string) => ['pod', id] as const,
};

/**
 * `enabled` because ShiftProvider sits ABOVE the auth gate — it has to, so a
 * relaunch can restart GPS before any screen mounts. Without the guard this
 * would fire on the sign-in screen, take a 401, burn a refresh attempt and sign
 * out a session that was never there.
 */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: keys.me,
    queryFn: endpoints.getMe,
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The driver's work list.
 *
 * Polled rather than pushed: the realtime topics on this backend are the
 * dispatcher's (`dispatch:tasks`, `dispatch:drivers`) and a driver token is not
 * meant to join them. A slow poll plus refetch-on-focus is what the console does
 * underneath its subscription anyway, and it is the safety net there too.
 */
export function useMyTasks(includeDelivered = false) {
  return useQuery({
    queryKey: keys.taskList(includeDelivered),
    queryFn: () => endpoints.getMyTasks(includeDelivered),
    select: (r) => r.data,
    refetchInterval: 45_000,
    staleTime: 15_000,
  });
}

/**
 * Delivered jobs, fetched a page at a time.
 *
 * Three deliberate differences from `useMyTasks`, all following from history
 * being unbounded where a run is not:
 *
 *  - **No `refetchInterval`.** Completed work does not change. Polling it would
 *    re-download a growing archive every 45 seconds to discover nothing, which
 *    is precisely the cost this split exists to remove.
 *  - **`enabled`**, so nothing is fetched until the driver actually opens the
 *    Completed tab or the History screen. First launch pays for the run only.
 *  - **A long `staleTime`.** A delivered job is finished; five minutes is
 *    conservative for something that cannot change.
 *
 * `meta.total` rides along on every page, which is what lets the Completed tab
 * show a count while holding only the first twenty rows.
 */
export function useMyHistory(enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.history,
    queryFn: ({ pageParam }) => endpoints.getMyHistory(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      // `undefined` is how TanStack is told there is nothing further; returning
      // a page number past the end would fetch empty pages forever.
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    enabled,
    staleTime: 300_000,
  });
}

export function useTask(id: string | undefined, options?: Partial<UseQueryOptions<TaskDetail>>) {
  return useQuery({
    queryKey: keys.task(id ?? 'none'),
    queryFn: () => endpoints.getTask(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
    ...options,
  });
}

export function useProofs(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.pod(id ?? 'none'),
    queryFn: () => endpoints.getProofs(id!),
    enabled: Boolean(id) && enabled,
    // The URLs are signed and expire (POD_SIGNED_URL_TTL, 300s by default), so
    // holding them longer than that hands the screen dead links.
    staleTime: 120_000,
    gcTime: 240_000,
  });
}

/**
 * One manual step forward.
 *
 * The server answers with the whole updated job, so the detail cache is written
 * from the response rather than refetched — the screen the driver is looking at
 * updates in the same tick the button releases.
 */
export function useChangeStatus(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ status, note }: { status: ManualStatus; note?: string }) =>
      endpoints.changeStatus(id, status, note),
    onSuccess: (updated) => {
      qc.setQueryData(keys.task(id), updated);
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
    onError: () => {
      // A 409 means the server's idea of the status differs from ours — someone
      // in dispatch moved it, or a retry landed twice. Refetch rather than guess.
      void qc.invalidateQueries({ queryKey: keys.task(id) });
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

export interface CaptureArgs {
  leg: PodLeg;
  photo: { uri: string; name: string; type: string };
  signature: { uri: string; name: string; type: string };
  /** Who signed — required, and gated in the UI before the upload is attempted. */
  signedByName: string;
  /** Pieces counted at this stop — confirmed with the driver before sending. */
  itemCount: number;
  note?: string;
  idempotencyKey: string;
}

/**
 * Capture proof. This is the only way PICKED_UP and DELIVERED are ever reached —
 * the status endpoint rejects both by schema — so a success here also means the
 * job moved, which is why everything about it is invalidated.
 */
export function useCaptureProof(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: CaptureArgs) => endpoints.captureProof({ id, ...args }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.task(id) });
      void qc.invalidateQueries({ queryKey: keys.pod(id) });
      void qc.invalidateQueries({ queryKey: keys.tasks });
    },
  });
}

/**
 * Set or clear the signed-in person's profile picture.
 *
 * Both paths invalidate `me`, which is where `avatarUrl` lives and therefore the
 * single thing every surface reads. The upload does hand back a URL of its own,
 * but writing it straight into the cache would put a value there that the next
 * refetch replaces anyway — and would have to be undone by hand if the refetch
 * disagreed. One source of truth is worth the extra round trip.
 */
export function useSetAvatar() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (photo: UploadFile) => endpoints.uploadAvatar(photo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useRemoveAvatar() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => endpoints.removeAvatar(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useSetShift() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (onShift: boolean) => endpoints.setShift(onShift),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}
