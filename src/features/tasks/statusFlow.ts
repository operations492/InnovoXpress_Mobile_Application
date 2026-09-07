import type { ConsignmentStatus, ManualStatus, NextAction, PodLeg, TaskType } from '@/api/types';
import { statusColor } from '@/theme/tokens';

/**
 * A mirror of the server's state machine — `constants/statusFlow.ts` and
 * `driverWork.service.ts`.
 *
 * It exists so the button can be labelled before the network answers, NOT so the
 * app can decide what is legal: the server re-checks every edge and answers 409
 * if it disagrees. When the two differ, the server is right and the screen
 * refetches.
 */

export const STATUS_LABELS: Record<ConsignmentStatus, string> = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED: 'Assigned',
  EN_ROUTE_TO_PICKUP: 'Going for pickup',
  AT_PICKUP: 'At pickup',
  PICKED_UP: 'Picked up',
  EN_ROUTE_TO_DELIVERY: 'Going to delivery',
  AT_DELIVERY: 'At delivery',
  DELIVERED: 'Delivered',
};

/**
 * What kind of job this is, in the driver's words.
 *
 * A map rather than a ternary, because there are three variants now and a
 * `=== 'PICKUP' ? … : …` silently labelled the new one as the old one. Every
 * order this system creates is `PICKUP_AND_DELIVERY`; the other two are older
 * rows that cannot be renamed away.
 */
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  PICKUP: 'Pickup',
  DELIVERY: 'Delivery',
  PICKUP_AND_DELIVERY: 'Pickup & Delivery',
};

/** The server's own wording, for anything quoting a status back verbatim. */
export const SERVER_STATUS_LABELS: Record<ConsignmentStatus, string> = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED: 'Assigned',
  EN_ROUTE_TO_PICKUP: 'En Route to Pickup',
  AT_PICKUP: 'At Pickup',
  PICKED_UP: 'Picked Up',
  EN_ROUTE_TO_DELIVERY: 'En Route to Delivery',
  AT_DELIVERY: 'At Delivery',
  DELIVERED: 'Delivered',
};

export function colorForStatus(status: ConsignmentStatus): string {
  return statusColor[status];
}

/** Every status after the pickup proof landed. */
const PICKUP_DONE: ConsignmentStatus[] = [
  'PICKED_UP',
  'EN_ROUTE_TO_DELIVERY',
  'AT_DELIVERY',
  'DELIVERED',
];

export const isPickupDone = (s: ConsignmentStatus): boolean => PICKUP_DONE.includes(s);
export const isDelivered = (s: ConsignmentStatus): boolean => s === 'DELIVERED';

/** Which half of the job the driver is working right now. */
export function activeLeg(status: ConsignmentStatus): PodLeg {
  return isPickupDone(status) ? 'DELIVERY' : 'PICKUP';
}

/** Mirrors `NEXT_ACTION` in driverWork.service.ts, for the detail endpoint which omits it. */
export function nextActionFor(status: ConsignmentStatus): NextAction {
  switch (status) {
    case 'ASSIGNED':
      return 'START_PICKUP';
    case 'EN_ROUTE_TO_PICKUP':
      return 'ARRIVE_AT_PICKUP';
    case 'AT_PICKUP':
      return 'CAPTURE_PICKUP_PROOF';
    case 'PICKED_UP':
      return 'START_DELIVERY';
    case 'EN_ROUTE_TO_DELIVERY':
      return 'ARRIVE_AT_DELIVERY';
    case 'AT_DELIVERY':
      return 'CAPTURE_DELIVERY_PROOF';
    default:
      return 'NONE';
  }
}

export interface ActionPlan {
  /** Text for the sticky primary button. */
  label: string;
  /**
   * How the action is performed:
   *  - `status` — PATCH /status with `target`
   *  - `proof`  — open the capture screen for `leg` (PICKED_UP / DELIVERED are
   *               POD-gated and the status endpoint rejects them by schema)
   *  - `none`   — terminal, nothing left to do
   */
  kind: 'status' | 'proof' | 'none';
  target?: ManualStatus;
  leg?: PodLeg;
}

const PLANS: Record<NextAction, ActionPlan> = {
  NONE: { label: 'Completed', kind: 'none' },
  START_PICKUP: { label: 'Start Pickup Task', kind: 'status', target: 'EN_ROUTE_TO_PICKUP' },
  ARRIVE_AT_PICKUP: { label: 'Arrive at Pickup', kind: 'status', target: 'AT_PICKUP' },
  CAPTURE_PICKUP_PROOF: { label: 'Complete Pickup', kind: 'proof', leg: 'PICKUP' },
  START_DELIVERY: { label: 'Start Delivery Task', kind: 'status', target: 'EN_ROUTE_TO_DELIVERY' },
  ARRIVE_AT_DELIVERY: { label: 'Arrive at Delivery', kind: 'status', target: 'AT_DELIVERY' },
  CAPTURE_DELIVERY_PROOF: { label: 'Complete Delivery', kind: 'proof', leg: 'DELIVERY' },
};

export function planFor(action: NextAction): ActionPlan {
  return PLANS[action] ?? PLANS.NONE;
}

export function planForStatus(status: ConsignmentStatus): ActionPlan {
  return planFor(nextActionFor(status));
}

const STATUS_ORDER: ConsignmentStatus[] = [
  'UNASSIGNED',
  'ASSIGNED',
  'EN_ROUTE_TO_PICKUP',
  'AT_PICKUP',
  'PICKED_UP',
  'EN_ROUTE_TO_DELIVERY',
  'AT_DELIVERY',
  'DELIVERED',
];

/** 0…1, for the progress rail on a task card. */
export function progressOf(status: ConsignmentStatus): number {
  const i = STATUS_ORDER.indexOf(status);
  return i <= 0 ? 0 : i / (STATUS_ORDER.length - 1);
}

/**
 * The job as the driver walks it — the six moves between ASSIGNED and DELIVERED.
 *
 * `UNASSIGNED` and `ASSIGNED` are not steps: they are what has happened *to* the
 * job before the driver touches it. Starting the list at "Going for pickup"
 * means every row is something the driver either did or is about to do, which is
 * the only reading that answers "where am I on this one".
 */
export interface JourneyStep {
  /** The status the job reaches once this step is done. */
  status: ConsignmentStatus;
  /** What the step is, in the tense it is read in once it is behind you. */
  label: string;
  /** What doing it involves. Shown only while it is the live step. */
  hint: string;
  leg: PodLeg;
  /** POD-gated: reached by capturing proof, not by PATCHing a status. */
  proof?: boolean;
}

export const JOURNEY: JourneyStep[] = [
  {
    status: 'EN_ROUTE_TO_PICKUP',
    label: 'Going for pickup',
    hint: 'Tap when you set off for the collection address.',
    leg: 'PICKUP',
  },
  {
    status: 'AT_PICKUP',
    label: 'At pickup',
    hint: 'Tap when you have arrived at the collection address.',
    leg: 'PICKUP',
  },
  {
    status: 'PICKED_UP',
    label: 'Picked up',
    hint: 'Photo, signature, who handed over and how many items.',
    leg: 'PICKUP',
    proof: true,
  },
  {
    status: 'EN_ROUTE_TO_DELIVERY',
    label: 'Going to delivery',
    hint: 'Tap when you set off for the delivery address.',
    leg: 'DELIVERY',
  },
  {
    status: 'AT_DELIVERY',
    label: 'At delivery',
    hint: 'Tap when you have arrived at the delivery address.',
    leg: 'DELIVERY',
  },
  {
    status: 'DELIVERED',
    label: 'Delivered',
    hint: 'Photo, signature, who received and how many items.',
    leg: 'DELIVERY',
    proof: true,
  },
];

/**
 * How far along the journey a status sits.
 *
 * `done` is how many steps are behind the driver, which is also the index of the
 * live one. It reaches `JOURNEY.length` on DELIVERED, where there is no live
 * step left — hence `current` being null rather than an out-of-range index.
 */
export function journeyPosition(status: ConsignmentStatus): {
  done: number;
  current: JourneyStep | null;
  total: number;
} {
  const reached = STATUS_ORDER.indexOf(status);
  // Everything before EN_ROUTE_TO_PICKUP counts as nothing done rather than as a
  // negative: an UNASSIGNED job should read "step 1 of 6", not "step -1".
  const done = Math.max(0, Math.min(JOURNEY.length, reached - 1));
  return { done, current: JOURNEY[done] ?? null, total: JOURNEY.length };
}
