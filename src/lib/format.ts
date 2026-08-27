import type { Decimalish } from '@/api/types';

/** Prisma `Decimal` reaches us as a string on some endpoints, a number on others. */
export function toNumber(value: Decimalish | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });

/**
 * 24-hour clock, used by chat.
 *
 * Separate from TIME above, which is 12-hour because that is what the task
 * mockups specify. Messages read better on a 24-hour clock: a shift crosses noon
 * and midnight, and '12:05' beside '12:05' with only AM/PM between them is the
 * one ambiguity worth designing out of a conversation about when something
 * happened.
 */
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `14:32` — the clock time of a message. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : CLOCK.format(d);
}

/** "10:11 PM Jul 07", the format the mockups use throughout. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${TIME.format(d)} ${DAY.format(d)}`;
}

/** "10:11 PM Jul 07 → 11:30 PM Jul 07", collapsing to one side when the other is absent. */
export function formatWindow(from: string | null, to: string | null): string {
  if (!from && !to) return 'No time window';
  if (from && !to) return `From ${formatStamp(from)}`;
  if (!from && to) return `By ${formatStamp(to)}`;
  return `${formatStamp(from)} → ${formatStamp(to)}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : TIME.format(d);
}

/** "in 25 min" / "12 min late" — a courier cares about the gap, not the clock. */
export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;

  const diffMin = Math.round((target - Date.now()) / 60_000);
  const abs = Math.abs(diffMin);

  if (abs < 1) return 'now';
  const label =
    abs < 60
      ? `${abs} min`
      : abs < 1440
        ? `${Math.round(abs / 60)} h`
        : `${Math.round(abs / 1440)} d`;

  return diffMin >= 0 ? `in ${label}` : `${label} late`;
}

export function formatWeight(kg: number | null): string {
  if (kg === null || kg === 0) return '—';
  return kg < 1 ? `${(kg * 1000).toFixed(0)} g` : `${kg.toFixed(kg % 1 === 0 ? 0 : 2)} kg`;
}

/** "1050 W Pender St, Unit 200 · Downtown, Vancouver" */
export function formatAddress(parts: {
  line1?: string | null;
  area?: string | null;
  city?: string | null;
}): string {
  const tail = [parts.area, parts.city].filter(Boolean).join(', ');
  return [parts.line1, tail].filter(Boolean).join(' · ');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/**
 * When a message arrived, in the shorthand every messaging app uses.
 *
 * Deliberately NOT `formatRelative`, which answers a different question: that
 * one is for delivery windows, where the interesting fact is whether a deadline
 * has passed, so it renders "in 4 min" and "28 min late". Pointed at a chat
 * timestamp it claims the message is late, which means nothing.
 *
 * The scale coarsens with age because that is how the information is used:
 * today is a clock time, this week is a weekday, older is a date. Nobody needs
 * "9,412 min" for any of them.
 */
export function formatChatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso);
  const ms = then.getTime();
  if (Number.isNaN(ms)) return '';

  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();

  /*
   * Today is always a clock time — never '12m ago'.
   *
   * A relative figure has to be read and then converted before it means
   * anything, and it goes stale the moment the row stops re-rendering. '14:32'
   * answers the question a driver is actually asking — was that before or after
   * I left the depot — and is still true an hour later.
   */
  if (sameDay) return CLOCK.format(then);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }

  // Inside a week a weekday is easier to place than a date.
  if (Date.now() - ms < 7 * 24 * 60 * 60_000) {
    return then.toLocaleDateString(undefined, { weekday: 'short' });
  }

  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
