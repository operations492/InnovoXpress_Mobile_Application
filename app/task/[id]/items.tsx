import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TaskItem } from '@/api/types';
import { Icon } from '@/components/Icon';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Body, Mono, Small, Tiny } from '@/components/Text';
import { useTask } from '@/features/tasks/queries';
import { formatWeight, toNumber } from '@/lib/format';
import { color, font } from '@/theme/tokens';

const PACKAGE_LABELS: Record<string, string> = {
  BOX: 'Box',
  BOTTLE: 'Bottle',
  ENVELOPE: 'Envelope',
  PALLET: 'Pallet',
  OTHER: 'Item',
};

/**
 * Items & packages — the counting screen.
 *
 * The tally is deliberately LOCAL and not sent anywhere: the backend has no
 * per-item scan state, and inventing one on the phone would produce a number
 * that dispatch cannot see and nobody can audit. This is a checklist for the
 * driver standing at the tailgate, and it says so.
 *
 * Item barcodes only exist on the detail endpoint, which is why this screen
 * reads the job in full rather than the list row.
 */
export default function ItemsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [counted, setCounted] = useState<Set<string>>(new Set());

  const { data: task, isLoading, isError, error, refetch } = useTask(id);

  // Stable identity: `done` below lists it as a dependency, and `?? []` would
  // otherwise hand it a brand-new array on every render.
  const items = useMemo(() => task?.items ?? [], [task?.items]);
  const total = items.length;
  const done = useMemo(
    () => items.filter((i) => counted.has(i.id)).length,
    [items, counted],
  );
  const allCounted = total > 0 && done === total;

  const toggle = (itemId: string) =>
    setCounted((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader title="Items & Packages" />

      {isLoading ? (
        <LoadingState label="Loading packages…" />
      ) : isError || !task ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <View style={[styles.counter, allCounted ? styles.counterDone : null]}>
            <View style={styles.counterMsg}>
              <Icon
                name={allCounted ? 'check-circle' : 'check-square'}
                size={16}
                color={allCounted ? color.success : color.muted}
              />
              <Small style={[styles.counterText, allCounted ? styles.counterTextDone : null]}>
                {allCounted ? 'All packages accounted for' : 'Tap an item to count it'}
              </Small>
            </View>
            <Mono style={[styles.count, allCounted ? styles.countDone : null]}>
              <Mono style={[styles.countN, allCounted ? styles.countNDone : null]}>{done}</Mono>
              {` / ${total}`}
            </Mono>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
            {items.length === 0 ? (
              <EmptyState
                icon="box"
                title="No packages listed"
                message="This order was logged without itemised packages. Check the job note or call dispatch."
              />
            ) : (
              items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  counted={counted.has(item.id)}
                  onPress={() => toggle(item.id)}
                />
              ))
            )}

            <Tiny style={styles.footnote}>
              This count is for your own check at the vehicle. It is not sent to dispatch — proof of
              pickup and delivery is the photo and signature you capture at each stop.
            </Tiny>
          </ScrollView>
        </>
      )}
    </View>
  );
}

function ItemRow({
  item,
  counted,
  onPress,
}: {
  item: TaskItem;
  counted: boolean;
  onPress: () => void;
}) {
  const weight = toNumber(item.weightKg);
  const unit = PACKAGE_LABELS[item.packageType ?? 'OTHER'] ?? 'Item';

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: counted }}
      accessibilityLabel={`${item.description}, quantity ${item.qty}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        counted ? styles.itemCounted : null,
        pressed ? styles.itemPressed : null,
      ]}
    >
      <View style={[styles.thumb, counted ? styles.thumbCounted : null]}>
        <Icon name="package" size={24} color={counted ? color.success : color.primary} />
        {counted ? (
          <View style={styles.badge}>
            <Icon name="check" size={12} color={color.onPrimary} />
          </View>
        ) : null}
      </View>

      <View style={styles.mid}>
        <Body style={styles.name} numberOfLines={1}>
          {item.description}
        </Body>
        <Mono style={styles.meta} numberOfLines={1}>
          {[weight !== null ? formatWeight(weight) : null, unit].filter(Boolean).join(' · ')}
        </Mono>
        {item.barcode ? (
          <View style={styles.barcode}>
            <Icon name="hash" size={13} color={color.faint} />
            <Mono style={styles.barcodeText} numberOfLines={1}>
              {item.barcode}
            </Mono>
          </View>
        ) : null}
      </View>

      <View style={styles.qty}>
        <Body style={[styles.qtyN, counted ? styles.qtyNDone : null]}>{item.qty}</Body>
        <Tiny style={styles.qtyU}>{unit}</Tiny>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },

  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    backgroundColor: color.surfaceSoft,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  counterDone: { backgroundColor: color.successSoft, borderBottomColor: color.successBorder },
  counterMsg: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  counterText: { fontSize: 13, color: color.body },
  counterTextDone: { color: color.successText, fontFamily: font.semibold },
  count: { fontFamily: font.monoBold, fontSize: 16, color: color.muted },
  countDone: { color: color.successText },
  countN: { fontFamily: font.monoBold, fontSize: 16, color: color.primary },
  countNDone: { color: color.success },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
  },
  itemCounted: { backgroundColor: color.successSoft },
  itemPressed: { opacity: 0.75 },

  thumb: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbCounted: { backgroundColor: '#D9F0E1' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: color.surface,
  },

  mid: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontFamily: font.semibold, color: color.ink },
  meta: { fontFamily: font.mono, fontSize: 12, color: color.muted },
  barcode: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  barcodeText: { fontFamily: font.mono, fontSize: 12, color: color.body },

  qty: { alignItems: 'center', minWidth: 44 },
  qtyN: { fontFamily: font.display, fontSize: 22, color: color.ink, lineHeight: 26 },
  qtyNDone: { color: color.successText },
  qtyU: { fontSize: 12, color: color.muted, marginTop: 4 },

  footnote: {
    paddingHorizontal: 20,
    paddingTop: 18,
    lineHeight: 17,
    color: color.muted,
    textAlign: 'center',
  },
});
