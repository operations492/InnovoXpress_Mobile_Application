import type { DriverTask } from '@/api/types';

/**
 * Finding one job in the run — the search box and the deadline chips.
 *
 * Pure functions over a list already in hand, deliberately. The live run is
 * "a handful of jobs" fetched whole (see `useMyTasks`), so every row the driver
 * could match on is already on the phone: filtering here is exact and costs no
 * round trip, which is what makes it instant on a van's connection.
 *
 * The delivered archive is the opposite — paged, unbounded, mostly not
 * downloaded — so it is NOT filtered through here. A search that quietly looked
 * at the twenty rows in hand and reported "no matches" out of four hundred
 * would be worse than no search at all. The Tasks screen hides the controls on
 * that lane rather than lying about their reach.
 */

/** Which deadline slice the driver is asking for. */
export type DueFilter = 'all' | 'today' | 'overdue';

/**
 * Everything a driver might plausibly type, flattened into one lowercase string.
 *
 * Built per task per keystroke rather than cached. That is affordable precisely
 * because the run is bounded by a shift — a few dozen rows at the very most —
 * and a cache keyed on task identity would have to be invalidated on every
 * refetch, which is a correctness risk taken on for no measurable gain.
 *
 * Phone numbers and order numbers appear TWICE: once as written and once
 * stripped to bare alphanumerics. Drivers type `ix1234` for `IX-1234` and
 * `03001234567` for `0300-123 4567`, and without the stripped copy neither
 * finds anything — the single most likely search in the app failing on
 * punctuation nobody can see.
 */
function haystack(task: DriverTask): string {
  const parts: (string | null | undefined)[] = [
    task.orderNo,
    squash(task.orderNo),
    task.client?.name,

    task.senderName,
    task.senderLine1,
    task.senderArea,
    task.senderCity,
    task.senderPhone,
    squash(task.senderPhone),

    task.receiverName,
    task.receiverLine1,
    task.receiverArea,
    task.receiverCity,
    task.receiverPhone,
    squash(task.receiverPhone),

    task.generalNote,

    // What is in the box. A driver who remembers the cargo but not the order
    // number — "the two pallets of tiles" — has nothing else to go on.
    ...task.items.map((item) => item.description),
  ];

  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Bare alphanumerics, lowercased — so punctuation cannot hide a match. */
function squash(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Split what was typed into tokens to match independently.
 *
 * Tokens are ANDed, which is what makes a search narrow as you type instead of
 * widening: "ali gulberg" means both words, in any order and in any field, so
 * a receiver name and an area combine into one useful query. A single
 * whole-string match would find nothing for that, since no field holds both.
 *
 * Returns the tokens BOTH as typed and squashed, because a token carrying
 * punctuation ("ix-1234") must still match the stripped copy in the haystack.
 */
export function searchTokens(query: string): string[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return tokens.map((token) => {
    const bare = squash(token);
    // Prefer the squashed form when stripping actually removed something and
    // left enough to be a search rather than a stray character.
    return bare.length > 1 && bare !== token ? bare : token;
  });
}

/** Every token has to appear somewhere in the row. */
export function matchesTokens(task: DriverTask, tokens: string[]): boolean {
  if (tokens.length === 0) return true;

  const hay = haystack(task);
  return tokens.every((token) => hay.includes(token));
}

/** Local midnight tonight — the boundary "due today" is measured against. */
function endOfToday(now: number): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

/**
 * Deadline filtering.
 *
 * `today` means "has to be done by tonight", so it INCLUDES work already
 * overdue — a job that was due yesterday is still due today, and hiding it
 * behind a second chip is how it gets forgotten. `overdue` is therefore a
 * subset, offered separately because "what have I already missed" is a question
 * a driver asks on its own.
 *
 * A row with an unparseable deadline matches neither. It cannot be shown to
 * satisfy a deadline question, and silently including it would put a job with
 * no known due date in a list the driver is reading as urgent.
 */
export function matchesDue(task: DriverTask, due: DueFilter, now: number): boolean {
  if (due === 'all') return true;

  const deadline = Date.parse(task.deliverBefore);
  if (Number.isNaN(deadline)) return false;

  // A delivered job cannot be late any more — its deadline stopped applying the
  // moment the proof was captured.
  if (task.status === 'DELIVERED') return false;

  if (due === 'overdue') return deadline < now;
  return deadline <= endOfToday(now);
}

/** True when anything is narrowing the list — drives the "clear" affordance. */
export function isFiltering(query: string, due: DueFilter): boolean {
  return query.trim().length > 0 || due !== 'all';
}

/**
 * Both controls at once, in one pass.
 *
 * Tokenised once for the whole list rather than per row, which is the only part
 * of this worth optimising: `searchTokens` allocates, and calling it inside the
 * predicate would redo that work for every card on every keystroke.
 */
export function filterTasks(
  tasks: DriverTask[],
  query: string,
  due: DueFilter,
  now: number,
): DriverTask[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0 && due === 'all') return tasks;

  return tasks.filter((task) => matchesDue(task, due, now) && matchesTokens(task, tokens));
}
