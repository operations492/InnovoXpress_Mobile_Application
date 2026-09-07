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
import { useMyTasks } from '@/features/tasks/queries';
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
   * One request feeds all three lanes.
   *
   * `includeDelivered` is the only filter this endpoint takes — there is no
   * status parameter and no page parameter — so asking for everything once and
   * splitting it here costs one round trip instead of two, makes switching lanes
   * instant, and shares its cache with the History tab, which was already
   * fetching exactly this.
   */
  const { data, isLoading, isError, error, refetch, isRefetching } = useMyTasks(true);

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
    const all = [...(data ?? [])].sort((a, b) => at(b.updatedAt) - at(a.updatedAt));
    const active = all.filter((t) => t.status !== 'DELIVERED');

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
      completed: all.filter((t) => t.status === 'DELIVERED'),
    };
  }, [data]);

  const list = lanes[lane];
  const shown = useMemo(() => list.slice(0, visible), [list, visible]);
  const hasMore = visible < list.length;

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
        const count = lanes[item.id].length;

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
         * The endpoint returns the whole list in one response — it takes no
         * offset or limit — so this windows what is already in hand rather than
         * fetching a page. That is still the part worth doing on a phone: it is
         * the mounted cards, not the JSON, that make a long list scroll badly.
         *
         * Fires slightly before the end so the next batch is in place by the
         * time the driver's thumb gets there.
         */
        onEndReached={() => hasMore && setVisible((v) => v + PAGE)}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          hasMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={color.primary} />
              <Tiny style={styles.footerText}>
                Showing {shown.length} of {list.length}
              </Tiny>
            </View>
          ) : list.length > PAGE ? (
            <View style={styles.footer}>
              <Tiny style={styles.footerText}>All {list.length} shown</Tiny>
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
