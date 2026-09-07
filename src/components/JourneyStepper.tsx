import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { ConsignmentStatus, PodLeg, TimelineEvent } from '@/api/types';
import { JOURNEY, journeyPosition, type ActionPlan } from '@/features/tasks/statusFlow';
import { formatEventStamp } from '@/lib/format';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { Body, Mono, SectionLabel, Small, Tiny } from './Text';

/**
 * The whole job as one list, with the driver's place in it marked.
 *
 * Before this, each move was a button that replaced the previous button, and the
 * only evidence of what had already happened was a status chip reading "At
 * pickup". A driver holding six jobs had to open each one and translate a
 * two-word label into a position. Laying the six steps out and marking them off
 * turns that into a glance: what is behind you carries the time it happened,
 * what is ahead is greyed, and the one live step sits between them carrying the
 * action itself.
 *
 * The live step is pressable and duplicates the sticky button at the bottom of
 * the screen. That is deliberate, not an oversight: the sticky button is the
 * one that is always reachable without scrolling, and this one is the one the
 * driver's eye is already on. They call the same handler.
 *
 * Completed proof steps are pressable too, and open what was captured. It is the
 * only place on the screen where "what did I photograph at the pickup" is
 * answerable without remembering that a separate card exists further down.
 */

type StepState = 'done' | 'current' | 'todo';

export function JourneyStepper({
  status,
  timeline,
  plan,
  busy,
  onAdvance,
  onViewProof,
}: {
  status: ConsignmentStatus;
  timeline: TimelineEvent[];
  /** The live action, from the same helper the sticky button uses. */
  plan: ActionPlan | null;
  busy: boolean;
  onAdvance: () => void;
  onViewProof: (leg: PodLeg) => void;
}) {
  const { done, total } = journeyPosition(status);

  /*
   * When each step happened, taken from the job's own history rather than
   * recomputed here. Built once per render as a lookup because the timeline is
   * newest-first and a scan per row would be six passes over the same array.
   *
   * Last write wins on purpose: the flow is forward-only, so a status appearing
   * twice means a correction, and the correction is the one worth showing.
   */
  const stampFor = new Map<ConsignmentStatus, string>();
  for (const event of timeline) stampFor.set(event.toStatus, event.recordedAt);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SectionLabel>Progress</SectionLabel>
        <Mono style={styles.counter}>
          {done >= total ? 'Complete' : `Step ${done + 1} of ${total}`}
        </Mono>
      </View>

      <View style={styles.steps}>
        {JOURNEY.map((step, i) => {
          const state: StepState = i < done ? 'done' : i === done ? 'current' : 'todo';
          const stamp = state === 'done' ? stampFor.get(step.status) : undefined;

          // A finished proof step opens what was captured; the live step does
          // whatever the plan says. Everything else is inert, and says so by
          // not being a Pressable at all.
          const press =
            state === 'current' && plan && plan.kind !== 'none'
              ? onAdvance
              : state === 'done' && step.proof
                ? () => onViewProof(step.leg)
                : undefined;

          return (
            <Step
              key={step.status}
              state={state}
              label={step.label}
              hint={step.hint}
              action={state === 'current' ? (plan?.kind !== 'none' ? plan?.label : null) : null}
              proof={step.proof}
              stamp={stamp}
              first={i === 0}
              last={i === JOURNEY.length - 1}
              busy={busy && state === 'current'}
              onPress={press}
            />
          );
        })}
      </View>
    </View>
  );
}

function Step({
  state,
  label,
  hint,
  action,
  proof,
  stamp,
  first,
  last,
  busy,
  onPress,
}: {
  state: StepState;
  label: string;
  hint: string;
  action?: string | null;
  proof?: boolean;
  stamp?: string;
  first: boolean;
  last: boolean;
  busy: boolean;
  onPress?: () => void;
}) {
  const done = state === 'done';
  const current = state === 'current';

  const body = (
    <View style={[styles.row, current ? styles.rowCurrent : null]}>
      {/*
        The rail is drawn as two half-connectors per row rather than one long
        line behind the column. A single absolutely-positioned line cannot know
        where the rows fall once the text wraps, and would either overshoot the
        last dot or stop short of it.
      */}
      <View style={styles.rail}>
        <View style={[styles.connector, first ? styles.connectorHidden : null]} />
        <View
          style={[
            styles.dot,
            done ? styles.dotDone : current ? styles.dotCurrent : styles.dotTodo,
          ]}
        >
          {done ? <Icon name="check" size={12} color={color.onPrimary} /> : null}
          {current ? <View style={styles.dotPip} /> : null}
        </View>
        <View
          style={[
            styles.connector,
            styles.connectorGrow,
            last ? styles.connectorHidden : null,
            done ? styles.connectorDone : null,
          ]}
        />
      </View>

      <View style={styles.text}>
        <View style={styles.labelRow}>
          <Body
            style={[
              styles.label,
              done ? styles.labelDone : null,
              current ? styles.labelCurrent : null,
            ]}
          >
            {label}
          </Body>
          {stamp ? <Tiny style={styles.stamp}>{formatEventStamp(stamp)}</Tiny> : null}
        </View>

        {current ? (
          <>
            <Small style={styles.hint}>{hint}</Small>
            {action ? (
              <View style={styles.action}>
                {/*
                  The spinner takes the arrow's place and the words stay put, so
                  the row keeps saying which move is in flight. Brand blue, the
                  same as the label it sits beside.
                */}
                {busy ? (
                  <ActivityIndicator size="small" color={color.primary} />
                ) : (
                  <Icon name={proof ? 'camera' : 'arrow-right'} size={14} color={color.primary} />
                )}
                <Tiny style={styles.actionLabel}>{busy ? `${action}…` : action}</Tiny>
              </View>
            ) : null}
          </>
        ) : null}

        {done && proof ? (
          <View style={styles.action}>
            <Icon name="image" size={13} color={color.muted} />
            <Tiny style={styles.viewProof}>View captured proof</Tiny>
          </View>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={current ? (action ?? label) : `${label}, view captured proof`}
      accessibilityState={{ busy }}
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}

const RAIL = 30;
const DOT = 20;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginTop: 14,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingTop: 13,
    paddingBottom: 9,
    gap: 10,
  },
  counter: { fontFamily: font.monoMedium, fontSize: 11.5, color: color.primary },
  steps: { paddingHorizontal: 15, paddingBottom: 12 },

  row: { flexDirection: 'row', gap: 11, minHeight: 40 },
  // The live step is tinted rather than outlined: a border here would sit inside
  // the rail and cut the connector line in half.
  rowCurrent: {
    backgroundColor: color.primarySoft,
    borderRadius: radius.md,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pressed: { opacity: 0.75 },

  rail: { width: RAIL, alignItems: 'center' },
  connector: { width: 2, height: 6, backgroundColor: color.line },
  // Grows so the line always reaches the next dot, however far the text wraps.
  connectorGrow: { flex: 1, minHeight: 10 },
  connectorDone: { backgroundColor: color.successBorder },
  connectorHidden: { backgroundColor: 'transparent' },

  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: color.success },
  dotCurrent: {
    backgroundColor: color.surface,
    borderWidth: 2.5,
    borderColor: color.primary,
  },
  dotPip: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.primary },
  dotTodo: { backgroundColor: color.surface, borderWidth: 2, borderColor: color.ctrl },

  text: { flex: 1, paddingBottom: 10, gap: 3 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: DOT },
  label: { flex: 1, fontSize: 14.5, color: color.faint, fontFamily: font.medium },
  labelDone: { color: color.body },
  labelCurrent: { color: color.ink, fontFamily: font.bold },
  stamp: { fontFamily: font.mono, fontSize: 11, color: color.muted },

  hint: { fontSize: 12.5, color: color.body, lineHeight: 17 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 3 },
  actionLabel: { fontFamily: font.bold, fontSize: 12.5, color: color.primary },
  viewProof: { fontFamily: font.medium, fontSize: 12, color: color.muted },
});
