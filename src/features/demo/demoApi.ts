import type {
  ConsignmentStatus,
  DriverTask,
  ManualStatus,
  Me,
  PodLeg,
  Proof,
  ShiftResponse,
  TaskDetail,
} from '@/api/types';
import { nextActionFor, SERVER_STATUS_LABELS } from '@/features/tasks/statusFlow';

/**
 * The whole backend, in memory.
 *
 * Every rule the real API enforces is enforced here too — the forward-only
 * status machine, PICKED_UP and DELIVERED reachable only through proof, both
 * files mandatory, 409 on an illegal move. A demo that lets you do things the
 * server would refuse is worse than no demo: it teaches the wrong flow and hides
 * exactly the bugs this screen exists to catch.
 *
 * State lives for the life of the process. Reload the app and the run resets,
 * which is what you want when showing the same walkthrough twice.
 */

/** A visible pause, so loading and disabled states are part of what you review. */
const delay = (ms = 320) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirrors the backend's AppError shape closely enough for the UI to react. */
class DemoConflict extends Error {
  readonly status = 409;
  readonly code = 'CONFLICT';
  readonly isConflict = true;
  readonly isOffline = false;
}

function iso(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

let eventSeq = 0;

function event(toStatus: ConsignmentStatus, note: string | null, minutesAgo: number) {
  eventSeq += 1;
  return {
    id: `evt-${eventSeq}`,
    fromStatus: null,
    toStatus,
    fromStatusLabel: null,
    toStatusLabel: SERVER_STATUS_LABELS[toStatus],
    driver: { id: 'drv-1', name: 'Imran Abdullah' },
    actorEmail: 'operations@innovoxpress.com',
    note,
    recordedAt: iso(-minutesAgo),
  };
}

/**
 * Three jobs: one not started, one part-way through, one finished — so every
 * state the button can be in is reachable without waiting, and History has
 * something in it.
 */
function seed(): TaskDetail[] {
  return [
    {
      id: 'job-1',
      orderNo: 'DRZ-20260818-0042',
      clientReference: 'ORD-20260702-0042',
      client: { id: 'cl-1', name: 'Dynacare', code: 'DYN' },
      driver: { id: 'drv-1', name: 'Imran Abdullah', code: 'D-07', mobile: '+1 604 555 0110' },
      status: 'ASSIGNED',
      statusLabel: 'Assigned',
      priority: 'HIGH',
      taskType: 'DELIVERY',
      sender: {
        name: 'Purolator — YVR Hub',
        phone: '+1 604 555 0148',
        email: 'dispatch@purolator-yvr.ca',
        line1: '1050 W Pender St, Unit 200',
        area: 'Coal Harbour',
        city: 'Vancouver',
        postcode: 'V6E 3S7',
        instructions: 'Please stay outside and call at the given number.',
        lat: 49.2871,
        lng: -123.1207,
      },
      receiver: {
        name: 'Taha Shams',
        phone: '+1 604 555 0199',
        email: 'taha@dynacare.ca',
        line1: '8100 River Rd, Dock B',
        area: 'Bridgeport',
        city: 'Richmond',
        postcode: 'V6X 1X7',
        notes: "Please don't knock — just call me once you've arrived.",
        lat: 49.1889,
        lng: -123.118,
      },
      readyBy: iso(-45),
      deliverBy: iso(75),
      assignedAt: iso(-60),
      pickedUpAt: null,
      deliveredAt: null,
      generalNote: 'Cold-chain specimens — deliver to lab reception.',
      items: [
        {
          id: 'it-1',
          description: 'Specimen cooler, sealed',
          qty: 1,
          weightKg: 0.6,
          packageType: 'BOX',
          barcode: 'B000001',
        },
        {
          id: 'it-2',
          description: 'Document satchel',
          qty: 1,
          weightKg: 0.8,
          packageType: 'ENVELOPE',
          barcode: 'B000002',
        },
      ],
      totals: { itemCount: 2, totalQty: 2, totalWeightKg: 1.4 },
      proofs: [],
      timeline: [event('ASSIGNED', 'Assigned to Imran Abdullah', 60)],
      createdAt: iso(-180),
      updatedAt: iso(-60),
    },
    {
      id: 'job-2',
      orderNo: 'APX-20260818-0041',
      clientReference: 'ORD-20260702-0041',
      client: { id: 'cl-2', name: 'Apple Express', code: 'APX' },
      driver: { id: 'drv-1', name: 'Imran Abdullah', code: 'D-07', mobile: '+1 604 555 0110' },
      status: 'PICKED_UP',
      statusLabel: 'Picked Up',
      priority: 'NORMAL',
      taskType: 'DELIVERY',
      sender: {
        name: 'BioScript Pharmacy',
        phone: '+1 604 555 0122',
        email: 'orders@bioscript.ca',
        line1: '3200 Boundary Rd',
        area: 'Renfrew',
        city: 'Burnaby',
        postcode: 'V5M 4A4',
        instructions: 'Ring the bell at the loading door.',
        lat: 49.262,
        lng: -123.023,
      },
      receiver: {
        name: 'Taha Shams',
        phone: '+1 604 555 0177',
        email: 'taha.shams@example.com',
        line1: '4500 Kingsway, Level 3',
        area: 'Metrotown',
        city: 'Burnaby',
        postcode: 'V5H 2B1',
        notes: 'Signature + photo POD required on drop.',
        lat: 49.2278,
        lng: -122.9997,
      },
      readyBy: iso(-160),
      deliverBy: iso(-20),
      assignedAt: iso(-200),
      pickedUpAt: iso(-30),
      deliveredAt: null,
      generalNote: 'Two totes, keep upright.',
      items: [
        {
          id: 'it-3',
          description: 'Pharmacy tote (chilled)',
          qty: 2,
          weightKg: 3.2,
          packageType: 'BOX',
          barcode: 'B000101',
        },
      ],
      totals: { itemCount: 1, totalQty: 2, totalWeightKg: 3.2 },
      proofs: [
        {
          leg: 'PICKUP',
          capturedAt: iso(-30),
          photoBytes: 842_113,
          signatureBytes: 18_442,
        },
      ],
      timeline: [
        event('PICKED_UP', 'Received by counter staff', 30),
        event('AT_PICKUP', null, 40),
        event('EN_ROUTE_TO_PICKUP', null, 55),
        event('ASSIGNED', 'Assigned to Imran Abdullah', 200),
      ],
      createdAt: iso(-320),
      updatedAt: iso(-30),
    },
    {
      id: 'job-3',
      orderNo: 'TCS-20260818-0039',
      clientReference: 'ORD-20260702-0039',
      client: { id: 'cl-3', name: 'TCS', code: 'TCS' },
      driver: { id: 'drv-1', name: 'Imran Abdullah', code: 'D-07', mobile: '+1 604 555 0110' },
      status: 'DELIVERED',
      statusLabel: 'Delivered',
      priority: 'NORMAL',
      taskType: 'DELIVERY',
      sender: {
        name: 'TCS Depot — Marine Way',
        phone: '+1 604 555 0170',
        email: 'depot@tcs.ca',
        line1: '7550 Marine Way',
        area: 'Big Bend',
        city: 'Burnaby',
        postcode: 'V5J 5G5',
        instructions: null,
        lat: 49.1985,
        lng: -122.9535,
      },
      receiver: {
        name: 'Nadia Rahman',
        phone: '+1 604 555 0165',
        email: null,
        line1: '2020 Commercial Dr',
        area: 'Grandview',
        city: 'Vancouver',
        postcode: 'V5N 4B2',
        notes: null,
        lat: 49.2681,
        lng: -123.0699,
      },
      readyBy: iso(-400),
      deliverBy: iso(-300),
      assignedAt: iso(-430),
      pickedUpAt: iso(-380),
      deliveredAt: iso(-305),
      generalNote: null,
      items: [
        {
          id: 'it-4',
          description: 'Document envelope',
          qty: 1,
          weightKg: 0.2,
          packageType: 'ENVELOPE',
          barcode: 'B000210',
        },
      ],
      totals: { itemCount: 1, totalQty: 1, totalWeightKg: 0.2 },
      proofs: [
        { leg: 'PICKUP', capturedAt: iso(-380), photoBytes: 610_233, signatureBytes: 14_002 },
        { leg: 'DELIVERY', capturedAt: iso(-305), photoBytes: 733_910, signatureBytes: 15_881 },
      ],
      timeline: [
        event('DELIVERED', 'Received by Nadia Rahman', 305),
        event('AT_DELIVERY', null, 315),
        event('EN_ROUTE_TO_DELIVERY', null, 370),
        event('PICKED_UP', null, 380),
        event('ASSIGNED', null, 430),
      ],
      createdAt: iso(-600),
      updatedAt: iso(-305),
    },
  ];
}

let jobs = seed();
let onShift = true;

function find(id: string): TaskDetail {
  const job = jobs.find((j) => j.id === id);
  if (!job) throw new DemoConflict('That job is not on your run.');
  return job;
}

/**
 * The list projection, derived from the detail record rather than stored twice —
 * the same reason the real backend derives it: two copies drift.
 */
function toListRow(job: TaskDetail): DriverTask {
  return {
    id: job.id,
    orderNo: job.orderNo,
    status: job.status,
    priority: job.priority,
    taskType: job.taskType,
    client: job.client ? { name: job.client.name } : null,
    senderName: job.sender.name,
    senderPhone: job.sender.phone,
    senderLine1: job.sender.line1,
    senderArea: job.sender.area,
    senderCity: job.sender.city,
    senderInstructions: job.sender.instructions,
    receiverName: job.receiver.name,
    receiverPhone: job.receiver.phone,
    receiverLine1: job.receiver.line1,
    receiverArea: job.receiver.area,
    receiverCity: job.receiver.city,
    receiverNotes: job.receiver.notes,
    readyBy: job.readyBy,
    deliverBy: job.deliverBy,
    generalNote: job.generalNote,
    items: job.items.map((i) => ({
      id: i.id,
      description: i.description,
      qty: i.qty,
      weightKg: i.weightKg,
      packageType: i.packageType,
    })),
    proofs: job.proofs.map((p) => ({ leg: p.leg, capturedAt: p.capturedAt })),
    nextAction: nextActionFor(job.status),
  };
}

/** The same four MANUAL edges the real `changeStatusSchema` permits. */
const MANUAL_EDGES: Partial<Record<ConsignmentStatus, ManualStatus>> = {
  ASSIGNED: 'EN_ROUTE_TO_PICKUP',
  EN_ROUTE_TO_PICKUP: 'AT_PICKUP',
  PICKED_UP: 'EN_ROUTE_TO_DELIVERY',
  EN_ROUTE_TO_DELIVERY: 'AT_DELIVERY',
};

export const demoApi = {
  async getMe(): Promise<Me> {
    await delay(160);
    return {
      id: 'demo-user',
      email: 'driver@innovoxpress.com',
      name: 'Imran Abdullah',
      role: 'driver',
      active: true,
      driver: { id: 'drv-1', name: 'Imran Abdullah', code: 'D-07', active: true, onShift },
    };
  },

  async getMyTasks(includeDelivered: boolean) {
    await delay();
    const rows = jobs
      .filter((j) => (includeDelivered ? true : j.status !== 'DELIVERED'))
      .map(toListRow);
    return { data: rows };
  },

  async getTask(id: string): Promise<TaskDetail> {
    await delay(220);
    return structuredClone(find(id));
  },

  async changeStatus(id: string, status: ManualStatus, note?: string): Promise<TaskDetail> {
    await delay();
    const job = find(id);

    if (MANUAL_EDGES[job.status] !== status) {
      throw new DemoConflict(
        `Cannot move from ${SERVER_STATUS_LABELS[job.status]} to ${SERVER_STATUS_LABELS[status]}`,
      );
    }

    job.status = status;
    job.statusLabel = SERVER_STATUS_LABELS[status];
    job.updatedAt = new Date().toISOString();
    job.timeline = [event(status, note ?? null, 0), ...job.timeline];

    return structuredClone(job);
  },

  async getProofs(id: string): Promise<Proof[]> {
    await delay(200);
    const job = find(id);
    return job.proofs.map((p) => ({
      leg: p.leg,
      capturedAt: p.capturedAt,
      signedByName: null,
      capturedByDriver: { id: 'drv-1', name: 'Imran Abdullah' },
      // No storage to sign a URL against; the screen handles a null url.
      photo: { mime: 'image/jpeg', bytes: p.photoBytes, url: null },
      signature: { mime: 'image/png', bytes: p.signatureBytes, url: null },
      replacedAt: null,
      expiresInSeconds: 300,
    }));
  },

  async captureProof(id: string, leg: PodLeg, note?: string) {
    await delay(700);
    const job = find(id);

    const required: ConsignmentStatus = leg === 'PICKUP' ? 'AT_PICKUP' : 'AT_DELIVERY';
    if (job.status !== required) {
      throw new DemoConflict(
        `${leg === 'PICKUP' ? 'Pickup' : 'Delivery'} proof can only be captured when the order is ` +
          `${SERVER_STATUS_LABELS[required]} — it is currently ${SERVER_STATUS_LABELS[job.status]}`,
      );
    }
    if (job.proofs.some((p) => p.leg === leg)) {
      throw new DemoConflict(`The ${leg.toLowerCase()} proof has already been captured`);
    }

    const now = new Date().toISOString();
    const next: ConsignmentStatus = leg === 'PICKUP' ? 'PICKED_UP' : 'DELIVERED';

    job.proofs = [...job.proofs, { leg, capturedAt: now, photoBytes: 912_004, signatureBytes: 16_338 }];
    job.status = next;
    job.statusLabel = SERVER_STATUS_LABELS[next];
    if (leg === 'PICKUP') job.pickedUpAt = now;
    else job.deliveredAt = now;
    job.updatedAt = now;
    job.timeline = [event(next, note ?? null, 0), ...job.timeline];

    return { proof: await this.getProofs(id) };
  },

  async setShift(next: boolean): Promise<ShiftResponse> {
    await delay(200);
    onShift = next;
    return {
      id: 'drv-1',
      name: 'Imran Abdullah',
      onShift,
      shiftStartedAt: next ? new Date().toISOString() : iso(-240),
      shiftEndedAt: next ? null : new Date().toISOString(),
    };
  },

  /** Position reporting has nowhere to go in demo mode; accept and drop. */
  async recordLocations() {
    return undefined;
  },

  /** Used by the banner's reset, so a walkthrough can be run again cleanly. */
  reset() {
    jobs = seed();
    onShift = true;
  },
};
