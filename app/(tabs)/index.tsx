import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DriverTask } from '@/api/types';
import { SecondaryButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { SearchField } from '@/components/SearchField';
import { FilterButton, TaskFilterSheet } from '@/components/TaskFilterSheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { TaskCard } from '@/components/TaskCard';
import { Tiny } from '@/components/Text';
import { usePendingProofIds } from '@/features/pod/usePendingProof';
import { filterTasks, isFiltering, type DueFilter } from '@/features/tasks/filter';
import { useMyHistory, useMyTasks } from '@/features/tasks/queries';
import { isPickupDone } from '@/features/tasks/statusFlow';
import { useNow } from '@/lib/clock';
import { useShift } from '@/state/ShiftProvider';
import { color, font, radius } from '@/theme/tokens';

/**
 * The driver's run — the Tasks mockup.
 *
 * Three lanes over one request, newest-touched first. See the note in `lanes`
 * for why the server's own `deliverBefore` ordering is overridden here.
 */

type Lane = 'active' | 'carrying' | 'completed';

/**
 * How many cards are mounted before the driver asks for more.
 *
 * Eight is roughly two screens on a mid-size phone, so the list is already
 * scrollable when it lands and `onEndReached` has somewhere to fire from. A page
 * that exactly fills the screen never triggers it and the list looks truncated
 * with no way forward.
 */
const PAGE = 8;

const LANES: { id: Lane; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'carrying', label: 'Carrying' },
  { id: 'completed', label: 'Completed' },
];

/**
 * How long "off shift" has to persist before it is worth telling the driver.
 *
 * Launch always passes through off-shift: `me` arrives with `onShift: false`,
 * ShiftProvider posts the clock-on, and the truth comes back a round trip
 * later. Rendering the notice during that window put a banner on screen for a
 * second and then took it away, shoving the whole list down and back up — the
 * jiggle this screen was reported for.
 *
 * Twenty seconds, which is deliberately longer than ShiftProvider's retry beat
 * (15s): what reaches this banner has had at least one retry fail, so it is a
 * phone that genuinely cannot reach dispatch rather than one mid-handshake.
 */
const OFF_SHIFT_GRACE_MS = 20_000;

export default function TasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { onShift } = useShift();
  const now = useNow();

  const [lane, setLane] = useState<Lane>('active');
  const [visible, setVisible] = useState(PAGE);
  const [query, setQuery] = useState('');
  const [due, setDue] = useState<DueFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);

  /*
   * Typing stays responsive even when the filter pass is the slow part.
   *
   * The field is driven by `query` so every keystroke appears immediately; the
   * list reads `deferredQuery`, which React is allowed to fall behind on under
   * load. Filtering a shift's worth of rows is quick enough that the two are
   * usually the same value — this is what keeps the caret smooth on a cheap
   * phone with a long run, rather than a timer that would make every search
   * feel laggy by design.
   */
  const deferredQuery = useDeferredValue(query);

  /*
   * Two requests, split along the line that matters: whether a slice is bounded.
   *
   * The run is a handful of jobs and changes constantly, so it is fetched whole
   * and polled. History only grows and never changes once written, so it is
   * paged, fetched on demand, and never polled — the Completed query does not
   * fire at all until the driver opens that tab.
   *
   * The alternative, one request for everything, is what this replaced. It meant
   * first launch downloaded every job the driver had ever delivered, and then did
   * it again every 45 seconds, to render eight rows.
   */
  const { data, isLoading, isError, error, refetch, isRefetching } = useMyTasks(false);

  /*
   * Always on, not gated on the Completed tab being open.
   *
   * Gating it would leave the Completed chip with no count until tapped, which
   * is worse than the thing it saves: one page is twenty rows, bounded and never
   * polled, where the old behaviour was every delivered job the driver had ever
   * had, re-fetched every 45 seconds. Fetching page one up front buys a correct
   * count and an instant tab, and costs a fixed amount no matter how long the
   * driver has worked here.
   */
  const history = useMyHistory();

  // Jobs whose proof is captured but still on the phone — the card says so.
  const queuedIds = usePendingProofIds();

  const lanes = useMemo(() => {
    /*
     * Most recently touched first, in every lane.
     *
     * `updatedAt` moves on every write the order takes — assignment, each status
     * step, a captured proof — so the job the driver just worked rises to the
     * top and the one dispatch just handed them appears without a scroll.
     *
     * This deliberately replaces the server's `deliverBefore asc` ordering. The cost
     * is that the driver's list and the dispatcher's console no longer read in
     * the same sequence, so "the third one down" stops being a shared phrase;
     * the deadline is still on every card, and the run is short enough that
     * recency wins.
     *
     * Sorted on a copy — `data` belongs to the query cache, and sorting it in
     * place would mutate what every other subscriber is reading.
     */
    // Live work only now — the server no longer sends delivered jobs on this
    // request, so there is nothing to filter out. The guard stays as a cheap
    // assertion of that contract rather than as working logic.
    const active = [...(data ?? [])]
      .sort((a, b) => at(b.updatedAt) - at(a.updatedAt))
      .filter((t) => t.status !== 'DELIVERED');

    return {
      active,
      /*
       * What is physically in the van: picked up, not yet delivered.
       *
       * A subset of `active` rather than a fourth slice of the run — the same
       * relationship WhatsApp's "Unread" has to "All" — because these have not
       * stopped being live work. It is the one set the driver is personally
       * holding, and the answer to the end-of-shift question that matters: is my
       * van empty. Reading it off the Active list means checking every card's
       * stage one at a time.
       */
      carrying: active.filter((t) => isPickupDone(t.status)),
      /*
       * Flattened from however many pages have been pulled in, already in server
       * order (newest completed first) — so no sort here. Re-sorting would be
       * actively wrong once more than one page is loaded: it can only order the
       * rows in hand, which is a different thing from ordering the archive.
       */
      completed: history.data?.pages.flatMap((p) => p.data) ?? [],
    };
  }, [data, history.data]);

  const onHistory = lane === 'completed';

  /**
   * Search and the deadline chips, applied to every lane.
   *
   * Completed is filtered too, with one caveat that the UI has to carry rather
   * than hide: it holds only the pages fetched so far, so a search there
   * reaches the rows on the phone and not the whole archive. Scrolling pulls
   * the next page in and widens it.
   *
   * The controls used to be HIDDEN on that lane instead, which was worse. The
   * search field and both chips vanished on tap and the bar emptied, which
   * reads as the screen breaking rather than as a considered limit — and it
   * still left the driver with no way to search their completed work at all.
   * Showing the controls and labelling their reach (see the footer) treats the
   * driver as someone who can be told the truth.
   *
   * Every lane is filtered rather than only the visible one, because the chip
   * counts above read from this and have to agree with what tapping them shows.
   */
  const filtered = useMemo(
    () => ({
      active: filterTasks(lanes.active, deferredQuery, due, now),
      carrying: filterTasks(lanes.carrying, deferredQuery, due, now),
      completed: filterTasks(lanes.completed, deferredQuery, due, now),
    }),
    [lanes, deferredQuery, due, now],
  );

  const list = filtered[lane];
  const filtering = isFiltering(deferredQuery, due);

  /*
   * Two kinds of "more", one gesture.
   *
   * The live lanes hold every row already, so growing the window is pure
   * rendering and instant. Completed holds only the pages fetched so far, so the
   * same scroll has to go and get the next one. The list below does not care
   * which — it calls `loadMore` and shows `hasMore`.
   *
   * Slicing happens AFTER filtering, which is the only order that works: slice
   * first and a search would look through the eight mounted cards rather than
   * the whole run, so a match on the ninth job would not exist until the driver
   * scrolled past it.
   */
  const shown = useMemo(
    () => (onHistory ? list : list.slice(0, visible)),
    [onHistory, list, visible],
  );
  const hasMore = onHistory ? history.hasNextPage : visible < list.length;
  const loadingMore = onHistory && history.isFetchingNextPage;

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    if (onHistory) {
      // Guarded: FlatList fires onEndReached more than once per overscroll, and
      // an unguarded call would request the same page several times over.
      if (!history.isFetchingNextPage) void history.fetchNextPage();
      return;
    }
    setVisible((v) => v + PAGE);
  }, [hasMore, onHistory, history]);

  /**
   * The archive's true size, which is not the number of rows on screen.
   *
   * It rides along on every page as `meta.total`, so the chip can say
   * "Completed 437" while holding twenty. Falling back to the loaded count keeps
   * it honest before the first page arrives rather than flashing a zero.
   */
  const completedTotal = history.data?.pages[0]?.meta.total ?? lanes.completed.length;

  /*
   * Resetting the window here rather than in an effect keyed on `lane`. An
   * effect would render the new lane once at the old length before correcting
   * itself, which on a long Completed list is a visible flash of forty cards.
   */
  const selectLane = useCallback((next: Lane) => {
    setLane(next);
    setVisible(PAGE);

    // The query deliberately SURVIVES a lane change. Looking for an order and
    // not finding it in Active, the next move is to check Completed — and
    // having to retype it there is the one thing that would make the search
    // feel broken. The field stays visible on every lane, so a carried-over
    // query is never hidden state.
  }, []);

  /*
   * Narrowing the list always puts the driver back at the top of it.
   *
   * Same reasoning as `selectLane`, and the same reason it is not an effect: a
   * search that kept a window of forty open would render forty cards for one
   * match, and the first result would be below the fold on the very keystroke
   * that found it.
   */
  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    setVisible(PAGE);
  }, []);

  /** Chosen from the sheet, which carries its own "All jobs" row to turn it off. */
  const changeDue = useCallback((next: DueFilter) => {
    setDue(next);
    setVisible(PAGE);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery('');
    setDue('all');
    setVisible(PAGE);
  }, []);

  const open = useCallback((task: DriverTask) => router.push(`/task/${task.id}`), [router]);

  /*
   * Off shift, but only once it has stuck — see OFF_SHIFT_GRACE_MS.
   */
  const offShiftForReal = useSettled(!onShift, OFF_SHIFT_GRACE_MS);

  /**
   * The bar holds the two things that narrow the list: search, and the filter.
   *
   * It replaced the shift pill, which was removed for two reasons: the shift is
   * automatic — opening the app starts it and there was nothing to press — and
   * its label moved between "Off shift", "Starting…" and "On shift" on every
   * launch, each a different width, so the pill resized and slid. The state is
   * still shown, in full and with its tracking diagnostic, in the Shift section
   * of the More tab, which is a screen you go to rather than one that twitches
   * while you read it.
   *
   * Putting the filter HERE rather than in a chip row under the lanes is what
   * stops it reading as a fourth lane. Narrowing lives in the bar; the lanes
   * below stay a plain three-way choice of which set you are looking at.
   *
   * The slot keeps a FIXED height, so nothing here can change the bar's height
   * and shunt the list.
   */
  const header = (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <View style={styles.slot}>
        <SearchField
          value={query}
          onChange={changeQuery}
          placeholder="Search orders, names, addresses"
          accessibilityLabel="Search by order number, name, address or item"
        />
        <FilterButton due={due} onPress={() => setFilterOpen(true)} />
      </View>
    </View>
  );

  /**
   * Chips on the canvas, below the header rather than inside it.
   *
   * Content-width and left-aligned rather than three stretched thirds: a chip
   * sized to its own label reads as a filter you applied, while equal segments
   * read as a mode switch and take three times the ink to say the same thing.
   *
   * One row that scrolls sideways, never two rows that wrap.
   *
   * Wrapping was tried first and is worse than it sounds: the row changes
   * HEIGHT when a chip moves to the second line, which pushes the list down —
   * and it does that in response to the filter chips appearing, so the layout
   * moves while the driver is reading it. A scroller is a fixed height whatever
   * it holds.
   *
   * This is the ScrollView an older comment here warned against, and the
   * warning was right about the symptom: as a flex child in this column it
   * shrank below its content and clipped the chips' bottom edge. The cause was
   * flex, not ScrollView — `flexShrink: 0` on the scroller pins it to its
   * content height and the clipping goes away, which keeps the row a fixed
   * height even with the OS text size turned up.
   *
   * The deadline filters are a SEPARATE row below, not more chips on this one.
   * Sharing the row was tried and read as one five-way switch: five pills of
   * the same size and shape, side by side, look like five choices of the same
   * kind — so "Active" and "Overdue" appeared to be alternatives when in fact
   * one picks the set and the other narrows it.
   */
  const laneTabs = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabsScroll}
      contentContainerStyle={styles.tabs}
      // The chips sit under a focused search field; a tap must toggle the
      // filter rather than being swallowed by the keyboard dismissing.
      keyboardShouldPersistTaps="handled"
    >
      {LANES.map((item) => {
        const selected = item.id === lane;
        /*
         * What tapping this chip would actually show.
         *
         * So the count follows the search: with a query on, "Active 2" means
         * two matches, not two jobs of which some are hidden.
         *
         * Completed is the awkward one. Idle, it reports what the SERVER says
         * exists rather than what has been downloaded, which is the whole point
         * of `meta.total` — it can say 437 while holding twenty. But once a
         * filter is on, that number is no longer the answer to "what would I
         * see", so it switches to the matches actually found.
         */
        const count =
          item.id === 'completed' && !filtering
            ? completedTotal
            : filtered[item.id].length;

        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${item.label}, ${count} job${count === 1 ? '' : 's'}`}
            onPress={() => selectLane(item.id)}
            style={({ pressed }) => [
              styles.chip,
              selected ? styles.chipOn : null,
              pressed && !selected ? styles.chipPressed : null,
            ]}
            hitSlop={6}
          >
            <Tiny style={[styles.chipLabel, selected ? styles.chipLabelOn : null]}>
              {item.label}
            </Tiny>
            {count > 0 ? (
              <Tiny style={[styles.chipCount, selected ? styles.chipCountOn : null]}>{count}</Tiny>
            ) : null}
          </Pressable>
        );
      })}

    </ScrollView>
  );

  if (isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        {laneTabs}

        <LoadingState label="Loading your run…" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.screen}>
        {header}
        {laneTabs}

        <ErrorState error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      {laneTabs}

      {/*
        Mounted once here rather than inside the button, so that opening it
        cannot remount the list behind it.
      */}
      <TaskFilterSheet
        visible={filterOpen}
        due={due}
        onSelect={changeDue}
        onClose={() => setFilterOpen(false)}
      />

      {/*
        Describes the situation; does not issue an order the driver cannot obey.

        It used to end "until you clock on", which was left over from the days
        of a manual switch. There is no switch any more — opening the app IS the
        shift — so that sentence asked for an action with no control behind it,
        on the one screen where the driver can do nothing about it. What is
        actually wrong is the connection, and that is what it says now; the app
        keeps retrying by itself and the banner clears when it takes.
      */}
      {offShiftForReal ? (
        <View style={styles.notice}>
          <Icon name="wifi-off" size={15} color={color.warn} />
          <Tiny style={styles.noticeText}>
            Dispatch has not confirmed your shift — they cannot assign you new work yet. It
            starts by itself once the app can reach the server.
          </Tiny>
        </View>
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TaskCard task={item} onPress={() => open(item)} queued={queuedIds.has(item.id)} />
        )}
        contentContainerStyle={[
          styles.list,
          shown.length === 0 ? styles.listEmpty : null,
          { paddingBottom: insets.bottom + 24 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        /*
         * Dismiss the keyboard as the driver starts scrolling the results.
         *
         * `on-drag` rather than a tap handler: the gesture that means "I am done
         * typing, let me read" is the scroll itself, and on a short run the
         * keyboard otherwise covers most of what was just found.
         */
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        /*
         * On the live lanes this widens the window over rows already held; on
         * Completed it fetches the next page from the server. Both are worth
         * doing — it is the mounted cards, not the JSON, that make a long list
         * scroll badly, and it is the JSON, not the cards, that makes a long
         * archive expensive to open.
         *
         * Fires slightly before the end so the next batch is in place by the
         * time the driver's thumb gets there.
         */
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          <ListFooter
            onHistory={onHistory}
            filtering={filtering}
            shown={shown.length}
            matches={list.length}
            loaded={lanes.completed.length}
            total={completedTotal}
            hasMore={Boolean(hasMore)}
            loading={loadingMore}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.primary}
            colors={[color.primary]}
          />
        }
        /*
         * An empty list means two completely different things, and conflating
         * them is how a driver concludes their work has vanished. "Nothing left
         * to do" is the happy end of a shift; "no matches" is a query they can
         * undo, so it comes with the button that undoes it.
         */
        ListEmptyComponent={
          filtering ? (
            <NoMatches
              query={deferredQuery}
              due={due}
              onHistory={onHistory}
              moreToLoad={Boolean(history.hasNextPage)}
              onClear={clearFilters}
            />
          ) : (
            <LaneEmpty lane={lane} />
          )
        }
      />
    </View>
  );
}

/**
 * What is at the bottom of the list, and how much of the truth it is showing.
 *
 * This carries the one honest caveat in the search: on Completed, a filter can
 * only look at the pages already fetched. Rather than hide the controls on that
 * lane — which made the screen look broken and helped nobody — the limit is
 * stated here, with the remedy, which is simply to keep scrolling.
 *
 * The live lanes have no such caveat: they hold every row the driver has, so a
 * count there is the whole answer.
 */
function ListFooter({
  onHistory,
  filtering,
  shown,
  matches,
  loaded,
  total,
  hasMore,
  loading,
}: {
  onHistory: boolean;
  filtering: boolean;
  /** Rows mounted right now. */
  shown: number;
  /** Rows matching in this lane — the same as the lane size when idle. */
  matches: number;
  /** Completed rows downloaded so far, across every page fetched. */
  loaded: number;
  /** Completed rows the SERVER says exist. */
  total: number;
  hasMore: boolean;
  loading: boolean;
}) {
  // Searching the archive: say what was actually looked at, always.
  if (onHistory && filtering) {
    const complete = loaded >= total;

    return (
      <View style={styles.footer}>
        {loading ? <ActivityIndicator size="small" color={color.primary} /> : null}
        <Tiny style={styles.footerText}>
          {matches} found · searched {complete ? `all ${total}` : `${loaded} of ${total}`}
        </Tiny>
        {complete ? null : (
          <Tiny style={styles.footerHint}>Keep scrolling to search further back</Tiny>
        )}
      </View>
    );
  }

  if (hasMore || loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={color.primary} />
        <Tiny style={styles.footerText}>
          Showing {shown} of {onHistory ? total : matches}
        </Tiny>
      </View>
    );
  }

  // Nothing worth saying about a list short enough to see in one go.
  const size = onHistory ? total : matches;
  if (size <= PAGE) return null;

  return (
    <View style={styles.footer}>
      {/*
        Says "matching" while a filter is on, so a count far below the lane's
        real size reads as the filter working rather than as jobs having gone
        missing.
      */}
      <Tiny style={styles.footerText}>
        All {size}
        {filtering ? ' matching' : ''} shown
      </Tiny>
    </View>
  );
}

/** Milliseconds, with an unparseable or missing stamp sorting to the bottom rather than throwing. */
function at(iso: string | null | undefined): number {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * True once `value` has been continuously true for `ms`.
 *
 * Any dip back to false restarts the clock, so this reports sustained state
 * rather than a transient one. Used to keep a condition that is briefly true on
 * every launch from drawing — and then undrawing — a banner that moves the list.
 *
 * The reset happens DURING RENDER rather than in an effect. React supports
 * adjusting state when an input changes by setting it directly in the render
 * body: it throws the render away and immediately re-runs with the new value,
 * which costs nothing extra. Doing it in an effect instead would commit the
 * stale value first and then re-render to correct it — a cascading render, and
 * the lint rule that forbids it is right, because for a hook whose entire job
 * is to suppress a flash, briefly committing the wrong answer defeats it.
 */
function useSettled(value: boolean, ms: number): boolean {
  const [timed, setTimed] = useState({ value, elapsed: false });

  if (timed.value !== value) setTimed({ value, elapsed: false });

  useEffect(() => {
    // Nothing to time while false; the reset above has already happened.
    if (!value) return;

    const timer = setTimeout(() => setTimed({ value: true, elapsed: true }), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);

  // ANDed with the live input so the very first render after a dip is already
  // false, without waiting for the state write above to land.
  return value && timed.elapsed;
}

/**
 * A search or filter that matched nothing.
 *
 * Names what was looked for, because the alternative — a bare "no results" —
 * leaves the driver unsure whether the query was wrong, the filter was on, or
 * the job really is not theirs any more.
 */
function NoMatches({
  query,
  due,
  onHistory,
  moreToLoad,
  onClear,
}: {
  query: string;
  due: DueFilter;
  onHistory: boolean;
  /** Completed only: pages exist that this search has not reached. */
  moreToLoad: boolean;
  onClear: () => void;
}) {
  const term = query.trim();
  const dueLabel = due === 'overdue' ? 'overdue' : due === 'today' ? 'due today' : null;

  /*
   * On Completed with pages still unfetched, "no matches" would be a claim this
   * screen cannot support — the job may be three pages down. Say what was
   * searched instead, so the driver scrolls rather than concluding it is gone.
   */
  if (onHistory && moreToLoad) {
    return (
      <View style={styles.noMatch}>
        <EmptyState
          icon="search"
          title="Nothing yet"
          message={
            term
              ? `Nothing matching “${term}” in the completed jobs loaded so far. Scroll down to load more of your archive.`
              : `Nothing ${dueLabel} in the completed jobs loaded so far. Scroll down to load more of your archive.`
          }
        />
        <SecondaryButton label="Clear search and filters" icon="x" onPress={onClear} />
      </View>
    );
  }

  const message = term
    ? dueLabel
      ? `Nothing ${dueLabel} matches “${term}”. The job may be in another lane, or already delivered.`
      : onHistory
        ? `No completed job matches “${term}”.`
        : `No job in this lane matches “${term}”. Check the Completed lane if you have already delivered it.`
    : `Nothing in this lane is ${dueLabel}.`;

  return (
    <View style={styles.noMatch}>
      <EmptyState icon="search" title="No matches" message={message} />
      <SecondaryButton label="Clear search and filters" icon="x" onPress={onClear} />
    </View>
  );
}

/**
 * Each lane is empty for a different reason, and saying which is the difference
 * between "you are done" and "something is broken".
 */
function LaneEmpty({ lane }: { lane: Lane }) {
  if (lane === 'carrying') {
    return (
      <EmptyState
        icon="package"
        title="Nothing in your van"
        message="A job appears here the moment you capture its pickup proof, and leaves it when you deliver."
      />
    );
  }

  if (lane === 'completed') {
    return (
      <EmptyState
        icon="clock"
        title="Nothing finished yet"
        message="Jobs move here once you capture the delivery proof. They stay until dispatch reassigns the order."
      />
    );
  }

  return (
    <EmptyState
      icon="coffee"
      title="Nothing left to do"
      message="Every job assigned to you is finished. New work appears here as soon as dispatch assigns it."
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  // Fixed height, occupied or not, so the bar is the same size on every lane.
  // `gap` separates the search field from the filter button; the height is
  // fixed so the bar cannot resize with its contents.
  slot: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },

  /*
   * `flexShrink: 0` is load-bearing, not tidying.
   *
   * A ScrollView is a flex child here, and the default `flexShrink: 1` lets the
   * column squeeze it below its own content — which crops the bottom few pixels
   * off every chip. Pinning it stops the squeeze, and `flexGrow: 0` stops the
   * opposite problem of it claiming the space the list needs.
   */
  tabsScroll: { flexGrow: 0, flexShrink: 0 },

  // On the canvas, not on the header's surface — the chips belong to the list
  // they filter, not to the bar above them.
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  // Soft tint rather than a solid fill: three chips in full brand colour would
  // outshout the cards underneath, which are the actual content.
  chipOn: { backgroundColor: color.primarySoft, borderColor: color.primaryBorder },
  chipPressed: { backgroundColor: color.surfaceSoft },
  chipLabel: { fontSize: 12.5, color: color.body, fontFamily: font.semibold },
  chipLabelOn: { color: color.primary, fontFamily: font.bold },
  // The count sits in the chip as text, not in a badge of its own. At this size
  // a nested pill is two borders and a background for two digits.
  chipCount: { fontSize: 11.5, color: color.muted, fontFamily: font.monoMedium },
  chipCountOn: { color: color.primary },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: color.warnSoft,
  },
  noticeText: { flex: 1, color: color.warn, fontFamily: font.medium, lineHeight: 17 },

  list: { padding: 14 },
  listEmpty: { flexGrow: 1 },
  gap: { height: 12 },

  // The empty state centres itself in the available space; the button sits
  // under it rather than inside it, so `EmptyState` stays the plain thing every
  // other screen uses.
  noMatch: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 4, paddingBottom: 24 },

  footer: { alignItems: 'center', gap: 7, paddingTop: 18, paddingBottom: 4 },
  footerText: { fontFamily: font.mono, fontSize: 11, color: color.muted },
  // Prose, not a figure — set in the body face so it does not read as another
  // count sitting under the one above it.
  footerHint: { fontFamily: font.medium, fontSize: 11, color: color.faint },
});
