import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import * as endpoints from '@/api/endpoints';
import type { ManualStatus, PodLeg, TaskDetail } from '@/api/types';

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

export function useSetShift() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (onShift: boolean) => endpoints.setShift(onShift),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}
