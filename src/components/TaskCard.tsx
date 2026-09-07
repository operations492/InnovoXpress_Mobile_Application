import { Pressable, StyleSheet, View } from 'react-native';
import type { DriverTask } from '@/api/types';
import {
  colorForStatus,
  JOURNEY,
  journeyPosition,
  STATUS_LABELS,
  TASK_TYPE_LABELS,
} from '@/features/tasks/statusFlow';
import { useNow } from '@/lib/clock';
import { formatRelative, formatWindow, toNumber } from '@/lib/format';
import { color, font, radius, shadow } from '@/theme/tokens';
import { Icon } from './Icon';
import { Body, Mono, Small, Tiny } from './Text';

/**
 * One job in the list — the `.task` card from the Tasks mockup.
 *
 * A task holds BOTH ends under one title. That is not decoration: a driver's
 * unit of work is the run from A to B, and splitting it into two rows is what
 * makes couriers deliver the right box to the wrong door.
 */
export function TaskCard({ task, onPress }: { task: DriverTask; onPress: () => void }) {
  const now = useNow();
  const accent = colorForStatus(task.status);
  const position = journeyPosition(task.status);
  const totalQty = task.items.reduce((sum, i) => sum + i.qty, 0);
  const totalKg = task.items.reduce((sum, i) => sum + (toNumber(i.weightKg) ?? 0), 0);

  // Late is the one thing worth shouting about on a list of otherwise equal rows.
  // `deliverBefore` is the deadline and is never null, so there is no fallback
  // to pick any more.
  const due = task.deliverBefore;
  const relative = formatRelative(due);
  // Read from the shared clock, not Date.now(): render must stay pure, and this
  // way a job that goes overdue while the list is open actually turns red.
  const late = Boolean(due && new Date(due).getTime() < now && task.status !== 'DELIVERED');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.orderNo}, ${STATUS_LABELS[task.status]}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.head}>
        <Body style={styles.title} numberOfLines={1}>
          {TASK_TYPE_LABELS[task.taskType]}
        </Body>

        <View style={styles.status}>
          <View style={[styles.statusDot, { backgroundColor: accent }]} />
          <Tiny style={[styles.statusLabel, { color: accent }]} numberOfLines={1}>
            {STATUS_LABELS[task.status]}
          </Tiny>
          <Icon name="chevron-right" size={16} color={color.faint} />
        </View>
      </View>

      {/*
        Six segments, one per step of the job, filled up to where this one has
        got to.

        The status label above says what the job is doing; this says how far
        through it is. They are not the same question, and a driver scanning six
        cards for "which of these is nearly done" was previously having to
        translate a phrase like "At pickup" into a position on a line they were
        holding in their head.
      */}
      <View style={styles.rail} accessibilityLabel={`Step ${position.done + 1} of ${position.total}`}>
        {JOURNEY.map((step, i) => (
          <View
            key={step.status}
            style={[
              styles.railSeg,
              i < position.done ? { backgroundColor: accent } : null,
              // The live one is dimmer than done but brighter than untouched, so
              // the eye lands on the boundary rather than counting segments.
              i === position.done ? { backgroundColor: color.primaryBorder } : null,
            ]}
          />
        ))}
      </View>

      <View style={styles.rows}>
        <Leg
          icon="package"
          tone="pick"
          address={`${task.senderLine1}, ${task.senderCity}`}
          name={task.client?.name ?? task.senderName}
        />
        <View style={styles.legLine}>
          <View style={styles.legLineDash} />
        </View>
        <Leg
          icon="map-pin"
          tone="drop"
          address={`${task.receiverLine1}, ${task.receiverCity}`}
          name={task.receiverName}
        />

        <View style={styles.meta}>
          <Icon name="clock" size={15} color={late ? color.dangerText : color.muted} />
          <Small style={[styles.metaText, late ? styles.late : null]} numberOfLines={1}>
            {formatWindow(task.pickupAfter, task.deliverBefore)}
          </Small>
          {relative ? (
            <Tiny style={[styles.relative, late ? styles.late : null]}>{relative}</Tiny>
          ) : null}
        </View>

        <View style={styles.meta}>
          <Icon name="box" size={15} color={color.muted} />
          <Small style={styles.metaText} numberOfLines={1}>
            {totalQty} item{totalQty === 1 ? '' : 's'}
            {totalKg > 0 ? ` · ${totalKg.toFixed(totalKg % 1 === 0 ? 0 : 1)} kg` : ''}
          </Small>
        </View>

        <View style={styles.meta}>
          <Icon name="link" size={15} color={color.muted} />
          <Mono style={styles.ref} numberOfLines={1}>
            {task.orderNo}
          </Mono>
        </View>

        {task.generalNote ? (
          <Small style={styles.note} numberOfLines={2}>
            {task.generalNote}
          </Small>
        ) : null}
      </View>
    </Pressable>
  );
}

function Leg({
  icon,
  tone,
  address,
  name,
}: {
  icon: 'package' | 'map-pin';
  tone: 'pick' | 'drop';
  address: string;
  name: string;
}) {
  const drop = tone === 'drop';
  return (
    <View style={styles.leg}>
      <View style={[styles.legIcon, drop ? styles.legIconDrop : null]}>
        <Icon name={icon} size={15} color={drop ? color.primary : color.muted} />
      </View>
      <View style={styles.legText}>
        <Body style={styles.legAddress} numberOfLines={2}>
          {address}
        </Body>
        <Small style={styles.legName} numberOfLines={1}>
          {name}
        </Small>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...shadow.card,
  },
  pressed: { backgroundColor: color.surfaceSoft },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
    gap: 8,
  },
  title: { flex: 1, fontFamily: font.display, fontSize: 15, color: color.ink, letterSpacing: -0.2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '55%' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontFamily: font.bold, fontSize: 12.5, flexShrink: 1 },

  rail: { flexDirection: 'row', gap: 3, paddingHorizontal: 15, paddingTop: 11 },
  railSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: color.line },

  rows: { padding: 15, gap: 0 },
  leg: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  legIcon: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: color.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  legIconDrop: { backgroundColor: color.primarySoft },
  legText: { flex: 1 },
  legAddress: { fontSize: 14.5, color: color.ink, lineHeight: 20 },
  legName: { fontSize: 13, color: color.muted, marginTop: 2 },

  legLine: { width: 24, alignItems: 'center', marginVertical: 2 },
  legLineDash: { width: 2, height: 16, backgroundColor: color.line, borderRadius: 1 },

  meta: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 9 },
  metaText: { flex: 1, fontSize: 13, color: color.body },
  relative: { fontFamily: font.bold, fontSize: 11.5, color: color.muted },
  late: { color: color.dangerText, fontFamily: font.bold },
  ref: { flex: 1, fontFamily: font.mono, fontSize: 12, color: color.muted },

  note: {
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: color.line2,
    fontSize: 12.5,
    color: color.muted,
    lineHeight: 18,
  },
});
