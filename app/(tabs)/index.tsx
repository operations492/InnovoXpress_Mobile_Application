import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DriverTask } from '@/api/types';
import { Icon } from '@/components/Icon';
import { ShiftStatus } from '@/components/ShiftStatus';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { TaskCard } from '@/components/TaskCard';
import { Body, Tiny } from '@/components/Text';
import { useMyTasks } from '@/features/tasks/queries';
import { useShift } from '@/state/ShiftProvider';
import { color, font, radius } from '@/theme/tokens';

type Filter = 'all' | 'active' | 'todo';

/**
 * The driver's run — the Tasks mockup.
 *
 * Ordering comes from the server (`deliverBy` then `createdAt`) and is left
 * alone: re-sorting on the phone would mean two drivers looking at the same run
 * in a different order, and dispatch describing job three while the driver sees
 * job one.
 */
export default function TasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { onShift } = useShift();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, isError, error, refetch, isRefetching } = useMyTasks(false);

  const tasks = useMemo(() => {
    const list = data ?? [];
    if (filter === 'active') {
      // Anything the driver has physically started.
      return list.filter((t) => t.status !== 'ASSIGNED');
    }
    if (filter === 'todo') return list.filter((t) => t.status === 'ASSIGNED');
    return list;
  }, [data, filter]);

  const open = useCallback((task: DriverTask) => router.push(`/task/${task.id}`), [router]);

  const header = (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${data?.length ?? 0} tasks. Tap to change filter.`}
        onPress={() =>
          setFilter((f) => (f === 'all' ? 'todo' : f === 'todo' ? 'active' : 'all'))
        }
        style={({ pressed }) => [styles.pill, pressed ? styles.pillOn : null]}
      >
        <Icon name="filter" size={16} color={color.ink} />
        <Body style={styles.pillText}>
          <Body style={styles.pillCount}>{tasks.length}</Body>
          {filter === 'all' ? ' Tasks' : filter === 'todo' ? ' Not started' : ' In progress'}
        </Body>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        onPress={() => void refetch()}
        style={({ pressed }) => [styles.circle, pressed ? styles.pillOn : null]}
      >
        <Icon name="refresh-cw" size={17} color={color.body} />
      </Pressable>

      <View style={styles.spacer} />
      <ShiftStatus />
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        <LoadingState label="Loading your run…" />
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

      {!onShift ? (
        <View style={styles.notice}>
          <Icon name="power" size={15} color={color.warn} />
          <Tiny style={styles.noticeText}>
            You are off shift. Dispatch cannot assign you new work until you clock on.
          </Tiny>
        </View>
      ) : null}

      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TaskCard task={item} onPress={() => open(item)} />}
        contentContainerStyle={[
          styles.list,
          tasks.length === 0 ? styles.listEmpty : null,
          { paddingBottom: insets.bottom + 24 },
        ]}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
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
            icon={filter === 'all' ? 'coffee' : 'filter'}
            title={filter === 'all' ? 'Nothing left to do' : 'Nothing in this filter'}
            message={
              filter === 'all'
                ? 'Every job assigned to you is finished. New work appears here as soon as dispatch assigns it.'
                : 'Tap the filter pill to see the rest of your run.'
            }
          />
        }
      />
    </View>
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // minHeight: the count label inside scales with the OS text size.
    minHeight: 40,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.ctrl,
  },
  pillOn: { backgroundColor: color.surfaceSoft },
  pillText: { fontSize: 13.5, color: color.ink, fontFamily: font.semibold },
  pillCount: { fontFamily: font.bold, color: color.ink },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.ctrl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { flex: 1 },

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
});
