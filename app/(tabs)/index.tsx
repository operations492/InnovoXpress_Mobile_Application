import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DriverTask } from '@/api/types';
import { Icon } from '@/components/Icon';
import { ShiftStatus } from '@/components/ShiftStatus';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { TaskCard } from '@/components/TaskCard';
import { Tiny } from '@/components/Text';
import { useMyHistory, useMyTasks } from '@/features/tasks/queries';
import { isPickupDone } from '@/features/tasks/statusFlow';
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

export default function TasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { onShift } = useShift();

  const [lane, setLane] = useState<Lane>('active');
  const [visible, setVisible] = useState(PAGE);

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

  const list = lanes[lane];
  const onHistory = lane === 'completed';

  /*
   * Two kinds of "more", one gesture.
   *
   * The live lanes hold every row already, so growing the window is pure
   * rendering and instant. Completed holds only the pages fetched so far, so the
   * same scroll has to go and get the next one. The list below does not care
   * which — it calls `loadMore` and shows `hasMore`.
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
  }, []);

  const open = useCallback((task: DriverTask) => router.push(`/task/${task.id}`), [router]);

  const header = (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      {/* Left is deliberately empty — the logo goes here. */}
      <View style={styles.spacer} />
      <ShiftStatus />
    </View>
  );

  /**
   * Chips on the canvas, below the header rather than inside it.
   *
   * Content-width and left-aligned rather than three stretched thirds: a chip
   * sized to its own label reads as a filter you applied, while equal segments
   * read as a mode switch and take three times the ink to say the same thing.
   *
   * A plain wrapping row, NOT a horizontal ScrollView. A ScrollView measures its
   * own height from its content, and as a flex child in this column it settled
   * shorter than the chips inside it — so the list below started too high and
   * clipped their bottom edge. `flexWrap` handles the same overflow case a
   * scroller was there for: with the OS text size turned up the chips move to a
   * second line instead of off the screen, and nothing can crop them.
   */
  const tabs = (
    <View style={styles.tabs}>
      {LANES.map((item) => {
        const selected = item.id === lane;
        // Completed reports what the server says exists, not what has been
        // downloaded — the two differ by every page not yet fetched.
        const count = item.id === 'completed' ? completedTotal : lanes[item.id].length;

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
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        {tabs}
        <LoadingState label="Loading your run…" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.screen}>
        {header}
        {tabs}
        <ErrorState error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      {tabs}

      {!onShift ? (
        <View style={styles.notice}>
          <Icon name="power" size={15} color={color.warn} />
          <Tiny style={styles.noticeText}>
            You are off shift. Dispatch cannot assign you new work until you clock on.
          </Tiny>
        </View>
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskCard task={item} onPress={() => open(item)} />}
        contentContainerStyle={[
          styles.list,
          shown.length === 0 ? styles.listEmpty : null,
          { paddingBottom: insets.bottom + 24 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
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
          hasMore || loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={color.primary} />
              <Tiny style={styles.footerText}>
                Showing {shown.length} of {onHistory ? completedTotal : list.length}
              </Tiny>
            </View>
          ) : (onHistory ? completedTotal : list.length) > PAGE ? (
            <View style={styles.footer}>
              <Tiny style={styles.footerText}>
                All {onHistory ? completedTotal : list.length} shown
              </Tiny>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.primary}
            colors={[color.primary]}
          />
        }
        ListEmptyComponent={<LaneEmpty lane={lane} />}
      />
    </View>
  );
}

/** Milliseconds, with an unparseable or missing stamp sorting to the bottom rather than throwing. */
function at(iso: string | null | undefined): number {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(ms) ? 0 : ms;
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
    // minHeight so the bar keeps its shape while the left side is empty and
    // waiting for the logo.
    minHeight: 52,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  spacer: { flex: 1 },

  // On the canvas, not on the header's surface — the chips belong to the list
  // they filter, not to the bar above them.
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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

  footer: { alignItems: 'center', gap: 7, paddingTop: 18, paddingBottom: 4 },
  footerText: { fontFamily: font.mono, fontSize: 11, color: color.muted },
});
