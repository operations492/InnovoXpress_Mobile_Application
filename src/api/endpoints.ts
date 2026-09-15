import { File as FsFile } from 'expo-file-system';
import { Platform } from 'react-native';
import { api } from './client';
import { env } from '@/lib/env';
import { demoApi } from '@/features/demo/demoApi';
import type { UploadFile } from '@/features/pod/capture';
import type {
  ChatAttachmentLinks,
  ChatConversationsResponse,
  ChatMessage,
  ChatMessagesPage,
  DriverTasksResponse,
  LocationPing,
  ManualStatus,
  Me,
  PodLeg,
  Proof,
  ShiftResponse,
  TaskDetail,
} from './types';

/**
 * Every driver-reachable route on the Innovo Xpress API, and nothing else.
 *
 * The console's endpoints (`GET /consignments`, `/reference`, `/map`, `/chat`)
 * are operator+ and answer 403 to a driver token, so they are deliberately
 * absent rather than present and broken.
 *
 * This is also the single seam where demo mode diverts to fixtures. Putting it
 * here rather than in the query hooks means the screens, the cache keys and the
 * error handling are identical in both modes — so what you review in demo is
 * what runs against the real server.
 */

/** Who am I — and, for a driver, the roster row behind the login. */
export const getMe = (): Promise<Me> =>
  env.demo ? demoApi.getMe() : api.get<{ user: Me }>('/api/auth/me').then((r) => r.user);

/** My own work list. Scoped by the token; there is no id to tamper with. */
export const getMyTasks = (includeDelivered = false): Promise<DriverTasksResponse> =>
  env.demo
    ? demoApi.getMyTasks(includeDelivered)
    : api.get<DriverTasksResponse>(
        `/api/drivers/me/consignments?includeDelivered=${includeDelivered ? 'true' : 'false'}`,
      );

/**
 * One job in full — coordinates, barcodes, timeline.
 *
 * The list endpoint omits all three, so the map, the item barcodes and the
 * history strip come from here. Guarded by `allowOperatorOrAssignedDriver`,
 * which answers 403 both for "not yours" and "does not exist".
 */
export const getTask = (id: string): Promise<TaskDetail> =>
  env.demo ? demoApi.getTask(id) : api.get<TaskDetail>(`/api/consignments/${id}`);

/**
 * Move a job along one manual step.
 *
 * Only the four travelling/arrived edges are accepted — PICKED_UP and DELIVERED
 * are rejected by the request schema because they require proof.
 */
export const changeStatus = (
  id: string,
  status: ManualStatus,
  note?: string,
): Promise<TaskDetail> =>
  env.demo
    ? demoApi.changeStatus(id, status, note)
    : api.patch<TaskDetail>(`/api/consignments/${id}/status`, {
        status,
        ...(note ? { note } : {}),
      });

export const getProofs = (id: string): Promise<Proof[]> =>
  env.demo
    ? demoApi.getProofs(id)
    : api.get<{ proof: Proof[] }>(`/api/consignments/${id}/pod`).then((r) => r.proof);

export interface CaptureProofInput {
  id: string;
  leg: PodLeg;
  photo: { uri: string; name: string; type: string };
  signature: { uri: string; name: string; type: string };
  /** The person who signed. Its own field now, not folded into the note. */
  signedByName: string;
  /**
   * Pieces counted at this stop — both legs. Two counts against one order is
   * what turns "something went missing" into "it went missing between these two
   * stops"; a single count at pickup can only ever say the sender was short.
   *
   * Sent as the driver counted them even when that disagrees with the order:
   * the discrepancy is the point, and the screen has already made them confirm
   * it.
   */
  itemCount: number;
  note?: string;
  /**
   * Makes a retry safe. If the response to the first attempt was lost — the
   * normal outcome on a phone with one bar — replaying the same key returns the
   * stored proof with 200 instead of "already captured" with 409.
   */
  idempotencyKey: string;
}

/**
 * Turn a captured file into something `fetch` will actually send.
 *
 * Expo installs a WinterCG-compliant `fetch` over React Native's, and the two
 * disagree about FormData: RN accepts its own `{uri, name, type}` part, the
 * spec-compliant one does not, and rejects it with
 *
 *   Error: Unsupported FormDataPart implementation
 *
 * — which surfaces as a bare transport failure, indistinguishable from being
 * offline. `expo/src/winter/fetch/convertFormData.ts` takes a string, a `Blob`,
 * or anything exposing `bytes()`, and reads the part's filename and
 * Content-Type off `.name` and `.type`.
 *
 * Both of those headers are load-bearing on the server, not cosmetic: busboy
 * treats a part with no filename as an ordinary text field, and multer's
 * `fileFilter` drops anything whose Content-Type is not a JPEG, PNG or WebP. Get
 * either wrong and the upload arrives with no files attached and fails
 * validation instead of failing loudly here.
 *
 * `expo-file-system`'s `File` reads the bytes, but its `type` is resolved by the
 * OS from the path and is documented as empty when the file cannot be read —
 * which would land us in the silent-drop case above. The name and type we
 * already worked out from the picker are the more reliable pair, so they are
 * pinned here and only the bytes are delegated.
 */
async function toFilePart(file: UploadFile): Promise<Blob> {
  if (Platform.OS === 'web') {
    // The signature pad hands back a data: URL on web, which has no filesystem
    // behind it — but it is fetchable, and the browser's own File carries the
    // name and type across.
    const blob = await (await fetch(file.uri)).blob();
    return new File([blob], file.name, { type: file.type });
  }

  const source = new FsFile(file.uri);
  return {
    name: file.name,
    type: file.type,
    bytes: () => source.bytes(),
  } as unknown as Blob;
}

/**
 * Capture proof and, in the same transaction on the server, advance the job to
 * PICKED_UP or DELIVERED. Both files are mandatory; the server sniffs the actual
 * bytes rather than trusting the declared content type.
 */
export async function captureProof({
  id,
  leg,
  photo,
  signature,
  signedByName,
  itemCount,
  note,
  idempotencyKey,
}: CaptureProofInput) {
  if (env.demo) return demoApi.captureProof(id, leg, note);

  const form = new FormData();
  form.append('photo', await toFilePart(photo));
  form.append('signature', await toFilePart(signature));
  form.append('signedByName', signedByName);
  // Multipart carries strings only; the server's Zod schema coerces it back.
  form.append('itemCount', String(itemCount));
  if (note) form.append('note', note);

  return api.upload<{ proof: Proof[] }>(
    `/api/consignments/${id}/pod/${leg.toLowerCase()}`,
    form,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

/** Clock on or off. Off-shift drivers cannot be given work — a 409 on the console side. */
export const setShift = (onShift: boolean): Promise<ShiftResponse> =>
  env.demo
    ? demoApi.setShift(onShift)
    : api.post<ShiftResponse>('/api/drivers/me/shift', { onShift });

/**
 * A batch of GPS fixes, up to 200. Batched because a courier's phone loses
 * signal constantly and one request per point would drop most of the trail.
 *
 * The 401 refresh-and-retry is left ON deliberately: this runs from a background
 * task where Supabase's own refresh timer is suspended, so a flush after a long
 * idle stretch is exactly the case that needs it.
 */
export const recordLocations = (pings: LocationPing[]): Promise<unknown> =>
  env.demo ? demoApi.recordLocations() : api.post<unknown>('/api/drivers/me/locations', { pings });

/* ------------------------------------------------------------------ chat */

/**
 * A driver reaches exactly the threads they were put in.
 *
 * The router-level gate is `driver`, but every `/:id` route is additionally
 * guarded by `requireConversationMember`, which tests membership rather than
 * role. There is deliberately no "new conversation" call here: `/directory`
 * returns `[]` for a driver and creating a space is operator-only, so threads
 * appear only because dispatch opened one.
 */
export const listConversations = (): Promise<ChatConversationsResponse> =>
  api.get<ChatConversationsResponse>('/api/chat/conversations');

/**
 * History, newest first. `before` pages backwards; `after` fetches everything
 * newer, which is how a client reconciles after a dropped socket — broadcast is
 * best-effort by design.
 */
export function listMessages(
  conversationId: string,
  params: { before?: string; after?: string; limit?: number } = {},
): Promise<ChatMessagesPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return api.get<ChatMessagesPage>(
    `/api/chat/conversations/${conversationId}/messages${q ? `?${q}` : ''}`,
  );
}

/**
 * `clientMessageId` is REQUIRED and must be a UUID the caller keeps.
 *
 * There is a unique index on (conversationId, clientMessageId): resending with
 * the same id returns the original message instead of duplicating it. On a phone
 * with one bar that is the difference between a retry and a double-post, so the
 * id belongs to the attempt, never to the request.
 */
export const sendMessage = (
  conversationId: string,
  input: { body: string; clientMessageId: string },
): Promise<ChatMessage> =>
  api.post<ChatMessage>(`/api/chat/conversations/${conversationId}/messages`, input);

/**
 * One file per message, 5 MB, any type — the server sniffs the bytes to decide
 * whether it is really an image rather than trusting the declared mime.
 *
 * The caption is optional because a file on its own is a valid message; a CHECK
 * constraint requires text, a file, or both.
 */
export const sendAttachment = (
  conversationId: string,
  form: FormData,
): Promise<ChatMessage> =>
  api.upload<ChatMessage>(`/api/chat/conversations/${conversationId}/attachments`, form);

/** Minted fresh per call and short-lived, so it cannot be cached. */
export const getAttachmentLinks = (
  conversationId: string,
  messageId: string,
): Promise<ChatAttachmentLinks> =>
  api.get<ChatAttachmentLinks>(
    `/api/chat/conversations/${conversationId}/messages/${messageId}/attachment`,
  );

/** Takes the last message actually RENDERED — never an implicit "now". */
export const markRead = (
  conversationId: string,
  lastMessageId: string,
): Promise<{ lastReadAt: string }> =>
  api.post<{ lastReadAt: string }>(`/api/chat/conversations/${conversationId}/read`, {
    lastMessageId,
  });

/**
 * Register (or clear) where to push notifications for this session.
 *
 * Keyed off the bearer token on the server, never a user id in the body — a
 * caller must not be able to redirect somebody else's notifications to their own
 * phone. `null` clears, which is what sign-out sends.
 */
export const setPushToken = (pushToken: string | null): Promise<void> =>
  env.demo
    ? Promise.resolve()
    : api.post<void>('/api/auth/push-token', { pushToken });
