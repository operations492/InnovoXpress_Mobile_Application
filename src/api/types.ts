/**
 * Wire types, transcribed from the backend's own DTOs.
 *
 * Deliberately hand-written rather than inferred: the app is a separate
 * deployable and the API is the contract between them, so a change on the server
 * should surface here as a compile error rather than as `any` flowing through.
 */

export type ConsignmentStatus =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'EN_ROUTE_TO_PICKUP'
  | 'AT_PICKUP'
  | 'PICKED_UP'
  | 'EN_ROUTE_TO_DELIVERY'
  | 'AT_DELIVERY'
  | 'DELIVERED';

/**
 * `PICKUP_AND_DELIVERY` is what a consignment in this system actually is — a
 * collection followed by a drop. The other two predate it and are kept because
 * an enum value cannot be removed without rewriting every row that used it, so
 * all three still arrive from the API.
 */
export type TaskType = 'DELIVERY' | 'PICKUP' | 'PICKUP_AND_DELIVERY';
export type Priority = 'NORMAL' | 'HIGH' | 'LOW';
export type PackageType = 'BOX' | 'BOTTLE' | 'ENVELOPE' | 'PALLET' | 'OTHER';
export type PodLeg = 'PICKUP' | 'DELIVERY';
export type UserRole = 'driver' | 'operator' | 'admin';

/** `driverWork.service.ts` — the server's own view of the single next step. */
export type NextAction =
  | 'NONE'
  | 'START_PICKUP'
  | 'ARRIVE_AT_PICKUP'
  | 'CAPTURE_PICKUP_PROOF'
  | 'START_DELIVERY'
  | 'ARRIVE_AT_DELIVERY'
  | 'CAPTURE_DELIVERY_PROOF';

/** Only the four MANUAL edges are settable through PATCH /status. */
export type ManualStatus =
  | 'EN_ROUTE_TO_PICKUP'
  | 'AT_PICKUP'
  | 'EN_ROUTE_TO_DELIVERY'
  | 'AT_DELIVERY';

/**
 * Prisma serialises `Decimal` as a JSON string, and the driver list returns the
 * raw column while the detail endpoint maps it through `Number()`. Rather than
 * pick one and be wrong half the time, both are accepted and normalised by
 * `toNumber()` in `src/lib/format.ts`.
 */
export type Decimalish = number | string | null;

// --------------------------------------------------------------- GET /auth/me

export interface Me {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  driver: {
    id: string;
    name: string;
    code: string | null;
    active: boolean;
    onShift: boolean;
  } | null;
}

// ------------------------------------------- GET /drivers/me/consignments

export interface TaskItemSummary {
  id: string;
  description: string;
  qty: number;
  weightKg: Decimalish;
  packageType: PackageType | null;
}

/** One row of the driver's work list. Note: no coordinates — see `TaskDetail`. */
export interface DriverTask {
  id: string;
  orderNo: string;
  status: ConsignmentStatus;
  priority: Priority;
  taskType: TaskType;
  client: { name: string } | null;

  senderName: string;
  senderPhone: string | null;
  senderLine1: string;
  senderArea: string | null;
  senderCity: string;
  senderInstructions: string | null;

  receiverName: string;
  receiverPhone: string | null;
  receiverLine1: string;
  receiverArea: string | null;
  receiverCity: string;
  receiverNotes: string | null;

  /*
   * The two ends of the job, and only those two — the list endpoint selects
   * `pickupAfter` and `deliverBefore` and leaves the inner bounds of each window
   * to the detail endpoint. Together they are the span the whole job has to fit
   * inside, which is what a card needs to show.
   *
   * Never null: all four columns are NOT NULL on the server.
   */
  pickupAfter: string;
  deliverBefore: string;
  generalNote: string | null;
  /** Last write of any kind — assignment, a status step, a proof. Drives list order. */
  updatedAt: string;

  items: TaskItemSummary[];
  proofs: { leg: PodLeg; capturedAt: string }[];
  nextAction: NextAction;
}

export interface DriverTasksResponse {
  data: DriverTask[];
}

// ------------------------------------------------- GET /consignments/:id

export interface Party {
  name: string;
  phone: string | null;
  email: string | null;
  line1: string;
  area: string | null;
  city: string;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
}

export interface Sender extends Party {
  instructions: string | null;
}

export interface Receiver extends Party {
  notes: string | null;
}

export interface TaskItem {
  id: string;
  description: string;
  qty: number;
  weightKg: Decimalish;
  packageType: PackageType | null;
  barcode: string | null;
}

export interface TimelineEvent {
  id: string;
  fromStatus: ConsignmentStatus | null;
  toStatus: ConsignmentStatus;
  fromStatusLabel: string | null;
  toStatusLabel: string;
  driver: { id: string; name: string } | null;
  actorEmail: string | null;
  note: string | null;
  recordedAt: string;
}

export interface TaskDetail {
  id: string;
  orderNo: string;
  clientReference: string | null;
  client: { id: string; name: string; code: string } | null;
  driver: { id: string; name: string; code: string | null; mobile: string | null } | null;
  status: ConsignmentStatus;
  statusLabel: string;
  priority: Priority;
  taskType: TaskType;
  sender: Sender;
  receiver: Receiver;
  /*
   * Two real windows, which is the whole point of the four columns: "collect
   * between 9 and 11, deliver between 13 and 17". The list endpoint sends only
   * the outer pair; this one sends all of it.
   */
  pickupAfter: string;
  pickupBefore: string;
  deliverAfter: string;
  deliverBefore: string;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  generalNote: string | null;
  items: TaskItem[];
  totals: { itemCount: number; totalQty: number; totalWeightKg: number };
  proofs: {
    leg: PodLeg;
    capturedAt: string;
    photoBytes: number | null;
    signatureBytes: number | null;
  }[];
  timeline: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------- GET /consignments/:id/pod

export interface ProofFile {
  mime: string | null;
  bytes: number | null;
  /** Short-lived signed URL — the `pod` bucket is private. */
  url: string | null;
}

export interface Proof {
  leg: PodLeg;
  capturedAt: string;
  /** Who signed: handed over on PICKUP, took delivery on DELIVERY. */
  signedByName: string | null;
  /** Pieces the driver counted at this stop — not necessarily the order's total. */
  itemCount: number | null;
  capturedByDriver: { id: string; name: string } | null;
  photo: ProofFile;
  signature: ProofFile;
  replacedAt: string | null;
  expiresInSeconds: number;
}

// --------------------------------------------- POST /drivers/me/locations

export interface LocationPing {
  lat: number;
  lng: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
  consignmentId?: string;
  /** ISO 8601. The device's own clock, so a buffered ping keeps its real time. */
  recordedAt?: string;
}

export interface ShiftResponse {
  id: string;
  name: string;
  onShift: boolean;
  shiftStartedAt: string | null;
  shiftEndedAt: string | null;
}

/* ------------------------------------------------------------------ chat */

/** A person in a thread. Drivers only ever see themselves and dispatch staff. */
export interface ChatParticipant {
  id: string;
  name: string;
  email: string;
  role: 'driver' | 'operator' | 'admin';
}

/**
 * Metadata only — never a URL.
 *
 * The server is explicit about this: a signed link expires, and this shape has
 * to stay byte-identical to the Realtime broadcast payload so one parser serves
 * both. Ask for the link separately, when the file is actually opened.
 */
export interface ChatAttachment {
  name: string;
  mime: string;
  bytes: number;
  /** Verified by sniffing the bytes server-side, not by trusting the mime. */
  isImage: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'TEXT' | 'SYSTEM';
  body: string | null;
  clientMessageId: string | null;
  createdAt: string;
  attachment: ChatAttachment | null;
}

/** GET /chat/conversations — slim rows, no members and no messages. */
export interface ChatConversationSummary {
  id: string;
  type: 'DIRECT' | 'SPACE';
  /** Already labelled for the viewer; a DIRECT thread has no stored name. */
  name: string;
  description: string | null;
  counterpart: ChatParticipant | null;
  memberCount: number;
  unreadCount: number;
  lastReadAt: string | null;
  lastMessageAt: string | null;
  lastMessage: {
    id: string;
    senderId: string;
    body: string | null;
    createdAt: string;
  } | null;
}

export interface ChatConversationsResponse {
  data: ChatConversationSummary[];
  /** Summed server-side so the tab badge needs no second request. */
  meta: { totalUnread: number };
}

/** Newest first. Cursors are opaque; `nextCursor` pages backwards. */
export interface ChatMessagesPage {
  data: ChatMessage[];
  meta: { hasMore: boolean; nextCursor: string | null };
}

/** GET .../attachment — short-lived links, minted per request. */
export interface ChatAttachmentLinks {
  messageId: string;
  name: string;
  mime: string;
  bytes: number;
  isImage: boolean;
  downloadUrl: string;
  /** Only ever set for verified images; everything else is download-only. */
  previewUrl: string | null;
  expiresInSeconds: number;
}
