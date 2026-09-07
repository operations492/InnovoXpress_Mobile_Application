import { useMemo } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriverTask } from '@/api/types';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Body, Display, Mono, SectionLabel, Small, Tiny } from '@/components/Text';
import { useMyTasks } from '@/features/tasks/queries';
import { dayKey, formatClock, formatDayLabel, formatDuration } from '@/lib/format';
import { color, font, radius, shadow } from '@/theme/tokens';

/**
 * What this driver has finished.
 *
 * `includeDelivered=true` is the only way to see a closed job — the work list
 * hides them by design, because the driver's screen should show what is left to
 * do rather than a growing pile of what is done.
 *
 * Note the server keeps no per-driver archive beyond the consignments still
 * assigned to them: once dispatch reassigns an order it leaves this list. That
 * is the backend's model, not an omission here.
 *
 * ## Why it is grouped by day
 *
 * A flat list of jobs each stamped "10:11 PM Jul 07" makes the reader parse a
 * date on every row to answer the only question they came with — what did I do
 * today, and what did I do yesterday. Grouping answers it in the headers and
 * frees each row to carry a clock time, which is the part that differs.
 */

interface Day {
  title: string;
  /** Sorts the sections; the title alone cannot ("Yesterday" < "Today"). */
  at: number;
  data: DriverTask[];
}

/** When a job actually finished — its delivery proof, or the last write to it. */
function finishedAt(task: DriverTask): string {
  return task.proofs.find((p) => p.leg === 'DELIVERY')?.capturedAt ?? task.updatedAt;
}

/** Pickup proof to delivery proof — how long the parcel was in the van. */
function transitOf(task: DriverTask): string {
  const pickup = task.proofs.find((p) => p.leg === 'PICKUP')?.capturedAt;
  const drop = task.proofs.find((p) => p.leg === 'DELIVERY')?.capturedAt;
  if (!pickup || !drop) return '';
  return formatDuration(new Date(drop).getTime() - new Date(pickup).getTime());
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, isError, error, refetch, isRefetching } = useMyTasks(true);

  const { sections, total, today } = useMemo(() => {
    const done = (data ?? [])
      .filter((t) => t.status === 'DELIVERED')
      .sort((a, b) => new Date(finishedAt(b)).getTime() - new Date(finishedAt(a)).getTime());

    // Insertion order is already newest-first, so the map preserves it and the
    // sections need no second sort of their own.
    const byDay = new Map<string, Day>();
    for (const task of done) {
      const iso = finishedAt(task);
      const key = dayKey(iso);
      const existing = byDay.get(key);
      if (existing) existing.data.push(task);
      else byDay.set(key, { title: formatDayLabel(iso), at: new Date(iso).getTime(), data: [task] });
    }

    const list = [...byDay.values()].sort((a, b) => b.at - a.at);
    return {
      sections: list,
      total: done.length,
      today: list.find((s) => s.title === 'Today')?.data.length ?? 0,
    };
  }, [data]);

  const header = (
    <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
      <Display style={styles.title}>History</Display>
      <Small>
        {total === 0
          ? 'Nothing completed yet'
          : today > 0
            ? `${total} completed · ${today} today`
            : `${total} completed`}
      </Small>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        <LoadingState />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.screen}>
        {header}
        <ErrorState error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        // Sticky headers so the day stays on screen while its jobs scroll past —
        // without it, a long day scrolls its own label away and the rows below
        // lose the only thing that dated them.
        stickySectionHeadersEnabled
        contentContainerStyle={[
          styles.list,
          sections.length === 0 ? styles.listEmpty : null,
          { paddingBottom: insets.bottom + 24 },
        ]}
        renderSectionHeader={({ section }) => (
          <View style={styles.dayHead}>
            <SectionLabel>{section.title}</SectionLabel>
            <Tiny style={styles.dayCount}>
              {section.data.length} job{section.data.length === 1 ? '' : 's'}
            </Tiny>
          </View>
        )}
        renderItem={({ item }) => (
          <HistoryRow task={item} onPress={() => router.push(`/task/${item.id}`)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        SectionSeparatorComponent={() => <View style={styles.sectionGap} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.primary}
            colors={[color.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="clock"
            title="Nothing finished yet"
            message="Jobs you complete appear here, grouped by the day you closed them."
          />
        }
      />
    </View>
  );
}

function HistoryRow({ task, onPress }: { task: DriverTask; onPress: () => void }) {
  const done = finishedAt(task);
  const transit = transitOf(task);
  const items = task.items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.orderNo}, delivered ${formatClock(done)}, ${task.receiverName}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      {/*
        The clock time is the row's anchor, on the left where the eye starts.
        Inside a day, "when" is the only thing that distinguishes one completed
        job from another, so it earns the position — and 24h, because a driver
        comparing it against a delivery window should not be parsing am/pm.
      */}
      <View style={styles.timeCol}>
        <Mono style={styles.time}>{formatClock(done)}</Mono>
        <View style={styles.tick}>
          <Icon name="check" size={11} color={color.onPrimary} />
        </View>
      </View>

      <View style={styles.body}>
        <Body style={styles.name} numberOfLines={1}>
          {task.receiverName}
        </Body>
        <Tiny style={styles.line} numberOfLines={1}>
          {task.receiverLine1}, {task.receiverCity}
        </Tiny>

        <View style={styles.facts}>
          <Mono style={styles.order} numberOfLines={1}>
            {task.orderNo}
          </Mono>
          {task.client?.name ? <Tiny style={styles.fact}>· {task.client.name}</Tiny> : null}
          <Tiny style={styles.fact}>
            · {items} item{items === 1 ? '' : 's'}
          </Tiny>
          {/*
            Pickup-to-delivery, which is the one number a driver is ever asked to
            account for after the fact. Absent when a proof is missing rather
            than shown as a zero, because "0 min" would be a claim.
          */}
          {transit ? <Tiny style={styles.transit}>· {transit} in transit</Tiny> : null}
        </View>
      </View>

      <Icon name="chevron-right" size={16} color={color.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  head: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  title: { fontSize: 20 },

  list: { padding: 14 },
  listEmpty: { flexGrow: 1 },
  gap: { height: 8 },
  sectionGap: { height: 6 },

  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 6,
    // Opaque, because it is sticky: a translucent header lets the rows it is
    // pinned over show through it.
    backgroundColor: color.bgCanvas,
  },
  dayCount: { fontFamily: font.mono, fontSize: 11, color: color.faint },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 12,
    paddingHorizontal: 13,
    ...shadow.card,
  },
  rowPressed: { backgroundColor: color.surfaceSoft },

  timeCol: { alignItems: 'center', gap: 5, width: 46 },
  time: { fontFamily: font.monoMedium, fontSize: 13, color: color.ink },
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: color.success,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: { flex: 1, gap: 2 },
  name: { fontFamily: font.semibold, fontSize: 14.5, color: color.ink },
  line: { fontSize: 12, color: color.muted },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 3 },
  order: { fontFamily: font.mono, fontSize: 11, color: color.muted },
  fact: { fontSize: 11, color: color.faint },
  transit: { fontSize: 11, color: color.successText, fontFamily: font.medium },
});
