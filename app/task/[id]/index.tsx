import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapView,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  type MapViewHandle,
  type Region,
} from '@/components/maps';

import { ApiError } from '@/api/client';
import type { TaskDetail } from '@/api/types';
import { ActionTile, PrimaryButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { showDialog } from '@/components/Dialog';
import { Chip } from '@/components/Chip';
import { DetailRow } from '@/components/DetailRow';
import { Icon } from '@/components/Icon';
import { JourneyStepper } from '@/components/JourneyStepper';
import { LegCard } from '@/components/LegCard';
import { ErrorState, LoadingState, messageFor } from '@/components/States';
import { Body, Mono, SectionLabel, Small, Tiny } from '@/components/Text';
import { setActiveConsignment } from '@/features/location/buffer';
import {
  activeLeg,
  colorForStatus,
  isDelivered,
  isPickupDone,
  journeyPosition,
  nextActionFor,
  planFor,
  STATUS_LABELS,
  TASK_TYPE_LABELS,
} from '@/features/tasks/statusFlow';
import { useChangeStatus, useTask } from '@/features/tasks/queries';
import { formatAddress, formatStamp, formatWindow } from '@/lib/format';
import { callNumber, openNavigation, sendEmail, textNumber } from '@/lib/navigate';
import { color, font, radius, shadow } from '@/theme/tokens';

/**
 * One job, top to bottom — the Task info mockup.
 *
 * The sticky button at the bottom is the whole screen: it always shows the ONE
 * next thing, and what that is comes from the server's own state machine rather
 * than from a second copy of the rules living here. When the two disagree — a
 * dispatcher moved the job, a retry landed twice — the server answers 409 and
 * this screen refetches instead of arguing.
 */
export default function TaskInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: task, isLoading, isError, error, refetch, isRefetching } = useTask(id);
  const changeStatus = useChangeStatus(id ?? '');

  /**
   * Tell the GPS buffer which job the driver has open, so fixes taken now are
   * attributed to it. Cleared on the way out — an untagged ping is better than
   * one tagged to a job the driver has already left.
   */
  useEffect(() => {
    if (id) void setActiveConsignment(id);
    return () => {
      void setActiveConsignment(null);
    };
  }, [id]);

  // True while a finger is down on the map — see the ScrollView note below.
  const [mapHeld, setMapHeld] = useState(false);

  const plan = useMemo(() => (task ? planFor(nextActionFor(task.status)) : null), [task]);

  const advance = useCallback(() => {
    if (!task || !plan) return;

    if (plan.kind === 'none') {
      router.back();
      return;
    }

    if (plan.kind === 'proof') {
      router.push(`/task/${task.id}/complete?leg=${plan.leg}`);
      return;
    }

    if (plan.target) {
      changeStatus.mutate(
        { status: plan.target },
        {
          onError: (e) => {
            const conflict = e instanceof ApiError && e.isConflict;
            void showDialog({
              title: conflict ? 'This job moved on' : 'Could not update',
              tone: conflict ? 'warn' : 'danger',
              message: messageFor(e),
            });
          },
        },
      );
    }
  }, [task, plan, router, changeStatus]);

  if (isLoading) {
    return (
      <Shell insetTop={insets.top}>
        <LoadingState label="Opening job…" />
      </Shell>
    );
  }

  if (isError || !task) {
    return (
      <Shell insetTop={insets.top}>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Shell>
    );
  }

  const pickupDone = isPickupDone(task.status);
  const delivered = isDelivered(task.status);
  const position = journeyPosition(task.status);
  const leg = activeLeg(task.status);
  const focus = leg === 'PICKUP' ? task.sender : task.receiver;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        /*
         * The page stops scrolling while a finger is on the map.
         *
         * A pannable map inside a vertical ScrollView is a gesture fight the
         * page always wins: drag to move the map north and the ScrollView reads
         * it as a scroll, so the map never moves. Suspending the parent for the
         * duration of the touch hands the gesture to the map, and releasing it
         * on touch end means the rest of the screen scrolls exactly as before.
         */
        scrollEnabled={!mapHeld}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={color.primary}
            colors={[color.primary]}
            progressViewOffset={insets.top + 40}
          />
        }
      >
        <View
          onTouchStart={() => setMapHeld(true)}
          onTouchEnd={() => setMapHeld(false)}
          onTouchCancel={() => setMapHeld(false)}
        >
          <TaskMap task={task} />
        </View>

        {/*
          Quick actions target whichever end the driver is heading to now — the
          sender before the pickup proof, the receiver after it.

          The caption above them is not decoration. The same four buttons dial
          two different people depending on how far through the job you are, and
          a driver who taps Call needs to know which one is about to ring before
          it does, not after.
        */}
        <View style={styles.quickHead}>
          <Icon
            name={leg === 'PICKUP' ? 'package' : 'map-pin'}
            size={13}
            color={color.primary}
          />
          <Tiny style={styles.quickHeadText} numberOfLines={1}>
            {leg === 'PICKUP' ? 'Pickup contact' : 'Delivery contact'} ·{' '}
            <Tiny style={styles.quickHeadName}>{focus.name}</Tiny>
          </Tiny>
          {focus.phone ? <Mono style={styles.quickPhone}>{focus.phone}</Mono> : null}
        </View>

        <View style={styles.quickRow}>
          <ActionTile
            label="Navigate"
            icon="navigation"
            onPress={() =>
              void openNavigation({
                lat: focus.lat,
                lng: focus.lng,
                address: formatAddress(focus),
                label: focus.name,
              })
            }
          />
          <ActionTile
            label="Call"
            icon="phone"
            disabled={!focus.phone}
            onPress={() => callNumber(focus.phone, focus.name)}
          />
          <ActionTile
            label="SMS"
            icon="message-square"
            disabled={!focus.phone}
            onPress={() => textNumber(focus.phone, focus.name)}
          />
          {/*
            Shown only when there is an address to write to, rather than greyed
            out on every job.

            No order in this system carries one — `senderEmail` and
            `receiverEmail` are null on every row, because nothing in the console
            collects them — so a permanently disabled fourth tile was teaching
            drivers that a quarter of this toolbar does not work. If dispatch
            ever starts capturing addresses, the button reappears on its own.
          */}
          {focus.email ? (
            <ActionTile
              label="Email"
              icon="mail"
              onPress={() => sendEmail(focus.email, `Innovo Xpress ${task.orderNo}`)}
            />
          ) : null}
        </View>

        {/*
          Said once, plainly, instead of leaving three greyed-out tiles to be
          interpreted. A missing number is a data problem for dispatch to fix,
          not a fault the driver should be left guessing at.
        */}
        {!focus.phone ? (
          <Tiny style={styles.quickMissing}>
            This order has no phone number for {focus.name}. Message dispatch in Chat if you need
            to reach them.
          </Tiny>
        ) : null}

        {/*
          Directly under the toolbar, above the addresses. It is the answer to
          "where am I on this one", and a driver who has to scroll past two
          address cards to find that out is back to reading a status chip.
        */}
        <JourneyStepper
          status={task.status}
          timeline={task.timeline}
          plan={plan}
          busy={changeStatus.isPending}
          onAdvance={advance}
          onViewProof={(podLeg) => router.push(`/task/${task.id}/complete?leg=${podLeg}&view=1`)}
        />

        <View style={styles.section}>
          <LegCard
            kind="pickup"
            name={task.sender.name}
            address={formatAddress(task.sender)}
            sub={task.client ? `${task.client.name} · ${task.sender.city}` : task.sender.city}
            instructions={task.sender.instructions}
            phone={task.sender.phone}
            email={task.sender.email}
            destination={{
              lat: task.sender.lat,
              lng: task.sender.lng,
              address: formatAddress(task.sender),
              label: task.sender.name,
            }}
            done={pickupDone}
            doneLabel="Picked up"
            showShare
          />

          <LegCard
            kind="delivery"
            name={task.receiver.name}
            address={formatAddress(task.receiver)}
            sub={task.receiver.city}
            instructions={task.receiver.notes}
            phone={task.receiver.phone}
            email={task.receiver.email}
            destination={{
              lat: task.receiver.lat,
              lng: task.receiver.lng,
              address: formatAddress(task.receiver),
              label: task.receiver.name,
            }}
            done={delivered}
            doneLabel="Delivered"
          />
        </View>

        <SectionLabel style={styles.sectionLabel}>Job details</SectionLabel>

        <Card style={styles.detailCard}>
          {/*
            Two rows, not one span. The detail endpoint carries all four bounds,
            and "collect between 9 and 11" is a different instruction from "be
            done by 17:00" — collapsing them into one line was the best the old
            two-column model could do, not what a driver wants to read.
          */}
          <DetailRow
            icon="package"
            label="Pickup window"
            value={formatWindow(task.pickupAfter, task.pickupBefore)}
            mono
          />
          <DetailRow
            icon="clock"
            label="Delivery window"
            value={formatWindow(task.deliverAfter, task.deliverBefore)}
            mono
          />

          <DetailRow icon="package" accent>
            <View style={styles.chips}>
              <Chip label={STATUS_LABELS[task.status]} accent={colorForStatus(task.status)} dot />
              <Chip label={TASK_TYPE_LABELS[task.taskType]} tone="neutral" />
              {task.priority !== 'NORMAL' ? (
                <Chip
                  label={`${task.priority} priority`}
                  tone={task.priority === 'HIGH' ? 'danger' : 'neutral'}
                />
              ) : null}
            </View>
          </DetailRow>

          {/*
            The count leads, because it is the number the driver is held to at
            both stops — the POD screen will not close a leg until their own
            count matches it. Weight is context; the quantity is the obligation.
          */}
          <DetailRow
            icon="box"
            label="Items to hand over"
            value={`${task.totals.totalQty} item${task.totals.totalQty === 1 ? '' : 's'}${
              task.totals.totalWeightKg > 0 ? ` · ${task.totals.totalWeightKg} kg` : ''
            }`}
            sub="Tap to view the package list"
            onPress={() => router.push(`/task/${task.id}/items`)}
          />

          {task.client?.name ? (
            <DetailRow icon="briefcase" label="Client" value={task.client.name} />
          ) : null}

          <DetailRow icon="link" label="Order number" value={task.orderNo} mono />

          {task.clientReference ? (
            <DetailRow icon="hash" label="Client reference" value={task.clientReference} mono />
          ) : null}

          {task.generalNote ? (
            <DetailRow icon="file-text" label="Instructions for this job" value={task.generalNote} last />
          ) : (
            <DetailRow icon="user" label="Assigned to" value={task.driver?.name ?? '—'} last />
          )}
        </Card>

        {/*
          There was a "Proof captured" card here, listing each leg's proof with a
          link to view it. The stepper now shows both, stamped and in position,
          well above this point — and two tap targets for one thing on one screen
          is how a driver ends up unsure which of them is the real record.
        */}

        <SectionLabel style={styles.sectionLabel}>History</SectionLabel>
        <Card style={styles.detailCard}>
          {task.timeline.slice(0, 6).map((e, i, arr) => (
            <View key={e.id} style={[styles.event, i === arr.length - 1 ? styles.eventLast : null]}>
              <View style={[styles.eventDot, { backgroundColor: colorForStatus(e.toStatus) }]} />
              <View style={styles.eventText}>
                <Body style={styles.eventTitle}>{e.toStatusLabel}</Body>
                {e.note ? <Small style={styles.eventNote}>{e.note}</Small> : null}
                <Tiny style={styles.eventMeta}>
                  {formatStamp(e.recordedAt)}
                  {e.driver?.name ? ` · ${e.driver.name}` : e.actorEmail ? ` · ${e.actorEmail}` : ''}
                </Tiny>
              </View>
            </View>
          ))}
          {task.timeline.length === 0 ? (
            <View style={styles.event}>
              <Small>Nothing has happened on this job yet.</Small>
            </View>
          ) : null}
        </Card>
      </ScrollView>

      {/* Floating controls, over the map — the mockup's `.float` buttons. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={[styles.float, styles.floatBack, { top: insets.top + 8 }]}
      >
        <Icon name="chevron-left" size={19} color={color.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh job"
        onPress={() => void refetch()}
        style={[styles.float, styles.floatMenu, { top: insets.top + 8 }]}
      >
        <Icon name="refresh-cw" size={17} color={color.ink} />
      </Pressable>

      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        {plan ? (
          <>
            {/*
              The same words as the live row in the stepper, so the button and
              the list read as one control rather than as two things to
              reconcile. Without it the driver has to scroll up to find out what
              the button is about to do to their job.
            */}
            {plan.kind !== 'none' && position.current ? (
              <Tiny style={styles.actionStep}>
                Step {position.done + 1} of {position.total} · {position.current.label}
              </Tiny>
            ) : null}
            <PrimaryButton
              label={plan.kind === 'none' ? 'Back to my tasks' : plan.label}
              icon={
                plan.kind === 'proof' ? 'camera' : plan.kind === 'none' ? 'check' : 'arrow-right'
              }
              loading={changeStatus.isPending}
              onPress={advance}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The map header.
 *
 * Rendered only when the order has coordinates. The console pins both ends when
 * an order is created, but older rows and seeded data may not have them, and a
 * map centred on null island is worse than no map at all.
 */
function TaskMap({ task }: { task: TaskDetail }) {
  const ref = useRef<MapViewHandle>(null);

  // Memoised because `region` below depends on them: a fresh object literal on
  // every render would make that useMemo recompute every time and memoise
  // nothing.
  const pickup = useMemo(
    () =>
      task.sender.lat != null && task.sender.lng != null
        ? { latitude: task.sender.lat, longitude: task.sender.lng }
        : null,
    [task.sender.lat, task.sender.lng],
  );
  const drop = useMemo(
    () =>
      task.receiver.lat != null && task.receiver.lng != null
        ? { latitude: task.receiver.lat, longitude: task.receiver.lng }
        : null,
    [task.receiver.lat, task.receiver.lng],
  );

  const region = useMemo<Region | null>(() => {
    const points = [pickup, drop].filter(Boolean) as {
      latitude: number;
      longitude: number;
    }[];
    if (points.length === 0) return null;

    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      // A floor on the span so a single pin, or two stops in the same block,
      // does not zoom in to a texture-less grey square.
      latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.02),
      longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.02),
    };
  }, [pickup, drop]);

  if (!region) {
    return (
      <View style={styles.mapFallback}>
        <Icon name="map-pin" size={22} color={color.faint} />
        <Small style={styles.mapFallbackText}>
          This order has no map pins. Navigate still works — it falls back to the address.
        </Small>
      </View>
    );
  }

  return (
    <View style={styles.map}>
      <MapView
        ref={ref}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {pickup ? (
          <Marker
            coordinate={pickup}
            title="Pickup"
            description={task.sender.name}
            pinColor={color.muted}
          />
        ) : null}
        {drop ? (
          <Marker
            coordinate={drop}
            title="Delivery"
            description={task.receiver.name}
            pinColor={color.primary}
          />
        ) : null}
        {pickup && drop ? (
          <Polyline
            coordinates={[pickup, drop]}
            strokeColor={color.primary}
            strokeWidth={3}
            // Dashed on purpose: this is the straight line between two stops, not
            // a driven route. Solid would imply a road that is not there.
            lineDashPattern={[8, 8]}
          />
        ) : null}
      </MapView>

      <View style={styles.mapLabel}>
        <Tiny style={styles.mapLabelText}>
          {task.receiver.city} · {task.taskType === 'PICKUP' ? 'pickup' : 'drop'}
        </Tiny>
      </View>

      {/*
        Recenter, because pan and zoom without a way back is a trap: three
        drags and both pins are off screen with nothing to say which direction
        they went. `region` is memoised, so this always returns to the framing
        the screen opened with.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recentre the map on both stops"
        onPress={() => ref.current?.animateToRegion(region, 300)}
        style={({ pressed }) => [styles.mapRecenter, pressed ? { opacity: 0.75 } : null]}
        hitSlop={6}
      >
        <Icon name="crosshair" size={17} color={color.ink} />
      </Pressable>
    </View>
  );
}

/** Back button over an otherwise empty screen, for the loading and error states. */
function Shell({ children, insetTop }: { children: React.ReactNode; insetTop: number }) {
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={[styles.float, styles.floatBack, { top: insetTop + 8 }]}
      >
        <Icon name="chevron-left" size={19} color={color.ink} />
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  scroll: { paddingBottom: 20 },

  /*
   * Taller than the mockup's 196. The map is the first thing a driver checks to
   * orient themselves, and at 196 the two pins and the line between them sat in
   * a letterbox with no useful context around either end.
   */
  map: { height: 260, backgroundColor: '#E4E7EC' },
  mapRecenter: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.float,
  },
  mapLabel: {
    position: 'absolute',
    left: 14,
    bottom: 12,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mapLabelText: { fontFamily: font.mono, fontSize: 10, color: color.muted },
  mapFallback: {
    height: 130,
    backgroundColor: '#E4E7EC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 40,
  },
  mapFallbackText: { textAlign: 'center', fontSize: 12, lineHeight: 17 },

  float: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.float,
  },
  floatBack: { left: 16 },
  floatMenu: { right: 16 },

  quickHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  quickHeadText: { flex: 1, fontSize: 11.5, color: color.muted },
  quickHeadName: { fontSize: 11.5, color: color.ink, fontFamily: font.bold },
  quickPhone: { fontFamily: font.mono, fontSize: 11.5, color: color.primary },
  quickMissing: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 10,
    borderRadius: 11,
    backgroundColor: color.warnSoft,
    color: color.warn,
    fontSize: 11.5,
    lineHeight: 16,
  },

  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 9 },
  section: { paddingHorizontal: 14, paddingTop: 12, gap: 12 },
  sectionLabel: { marginHorizontal: 18, marginTop: 18, marginBottom: 8 },
  detailCard: { marginHorizontal: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },

  event: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
  },
  eventLast: { borderBottomWidth: 0 },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  eventText: { flex: 1, gap: 2 },
  eventTitle: { fontFamily: font.semibold, fontSize: 14, color: color.ink },
  eventNote: { fontSize: 12.5, color: color.body },
  eventMeta: { fontFamily: font.mono, fontSize: 11, color: color.muted },

  actionBar: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  actionStep: {
    textAlign: 'center',
    fontFamily: font.mono,
    fontSize: 11,
    color: color.muted,
    marginBottom: 8,
  },
});
