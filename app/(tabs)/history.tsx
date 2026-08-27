import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriverTask } from '@/api/types';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Body, Display, Mono, Small, Tiny } from '@/components/Text';
import { useMyTasks } from '@/features/tasks/queries';
import { formatStamp } from '@/lib/format';
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
 */
export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, isError, error, refetch, isRefetching } = useMyTasks(true);

  const delivered = useMemo(
    () => (data ?? []).filter((t) => t.status === 'DELIVERED'),
    [data],
  );

  const header = (
    <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
      <Display style={styles.title}>History</Display>
      <Small>
        {delivered.length} completed job{delivered.length === 1 ? '' : 's'} still on your name
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
      <FlatList
        data={delivered}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[
          styles.list,
          delivered.length === 0 ? styles.listEmpty : null,
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
        renderItem={({ item }) => (
          <HistoryRow task={item} onPress={() => router.push(`/task/${item.id}`)} />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="clock"
            title="Nothing finished yet"
            message="Jobs you complete appear here with the time each stop was proved."
          />
        }
      />
    </View>
  );
}

function HistoryRow({ task, onPress }: { task: DriverTask; onPress: () => void }) {
  const deliveryProof = task.proofs.find((p) => p.leg === 'DELIVERY');
  const pickupProof = task.proofs.find((p) => p.leg === 'PICKUP');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.orderNo}, delivered`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: color.surfaceSoft } : null]}
    >
      <View style={styles.check}>
        <Icon name="check" size={16} color={color.success} />
      </View>

      <View style={styles.rowText}>
        <Body style={styles.rowTitle} numberOfLines={1}>
          {task.receiverName}
        </Body>
        <Tiny style={styles.rowLine} numberOfLines={1}>
          {task.receiverLine1}, {task.receiverCity}
        </Tiny>
        <View style={styles.stamps}>
          {pickupProof ? (
            <Mono style={styles.stamp}>↑ {formatStamp(pickupProof.capturedAt)}</Mono>
          ) : null}
          {deliveryProof ? (
            <Mono style={styles.stamp}>↓ {formatStamp(deliveryProof.capturedAt)}</Mono>
          ) : null}
        </View>
      </View>

      <View style={styles.rowEnd}>
        <Mono style={styles.orderNo} numberOfLines={1}>
          {task.orderNo}
        </Mono>
        <Icon name="chevron-right" size={16} color={color.faint} />
      </View>
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
  gap: { height: 10 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 13,
    ...shadow.card,
  },
  check: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: font.semibold, fontSize: 15, color: color.ink },
  rowLine: { fontSize: 12, color: color.muted },
  stamps: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 3 },
  stamp: { fontFamily: font.mono, fontSize: 11, color: color.successText },
  rowEnd: { alignItems: 'flex-end', gap: 6 },
  orderNo: { fontFamily: font.mono, fontSize: 11, color: color.faint },
});
