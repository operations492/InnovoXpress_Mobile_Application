import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapView, Marker, Polyline, PROVIDER_DEFAULT, type Region } from '@/components/maps';
import { MapPlaceholder } from '@/components/MapPlaceholder';
import {
  MAPS_UNCONFIGURED_DETAIL,
  MAPS_UNCONFIGURED_TITLE,
  mapsConfigured,
} from '@/lib/mapsConfig';

import { ApiError } from '@/api/client';
import type { TaskDetail } from '@/api/types';
import { ActionTile, PrimaryButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DetailRow } from '@/components/DetailRow';
import { Icon } from '@/components/Icon';
import { LegCard } from '@/components/LegCard';
import { ErrorState, LoadingState, messageFor } from '@/components/States';
import { Body, SectionLabel, Small, Tiny } from '@/components/Text';
import { setActiveConsignment } from '@/features/location/buffer';
import {
  activeLeg,
  colorForStatus,
  isDelivered,
  isPickupDone,
  nextActionFor,
  planFor,
  STATUS_LABELS,
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
            Alert.alert(
              e instanceof ApiError && e.isConflict ? 'This job moved on' : 'Could not update',
              messageFor(e),
            );
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
  const leg = activeLeg(task.status);
  const focus = leg === 'PICKUP' ? task.sender : task.receiver;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
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
        <TaskMap task={task} />

        {/* Quick actions target whichever end the driver is heading to now. */}
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
            onPress={() => callNumber(focus.phone)}
          />
          <ActionTile
            label="SMS"
            icon="message-square"
            disabled={!focus.phone}
            onPress={() => textNumber(focus.phone)}
          />
          <ActionTile
            label="Email"
            icon="mail"
            disabled={!focus.email}
            onPress={() => sendEmail(focus.email, `Innovo Xpress ${task.orderNo}`)}
          />
        </View>

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
          <DetailRow
            icon="clock"
            value={formatWindow(task.readyBy, task.deliverBy)}
            mono
            sub={task.priority !== 'NORMAL' ? `${task.priority} priority` : undefined}
          />

          <DetailRow icon="package" accent>
            <View style={styles.chips}>
              <Chip label={STATUS_LABELS[task.status]} accent={colorForStatus(task.status)} dot />
              <Chip
                label={task.taskType === 'PICKUP' ? 'Pickup' : 'Pickup & Delivery'}
                tone="danger"
              />
              <Chip label={task.orderNo} tone="mono" />
            </View>
          </DetailRow>

          <DetailRow
            icon="box"
            value={`Quantity: ${task.totals.totalQty} · Weight: ${task.totals.totalWeightKg} kg`}
            sub="Tap to view package list"
            onPress={() => router.push(`/task/${task.id}/items`)}
          />

          {/*
            Both proofs are mandatory on this backend — the POD endpoint rejects a
            capture that is missing either file — so this is a statement of fact,
            not a per-order setting.
          */}
          <DetailRow icon="camera" label="Required at each stop">
            <View style={styles.chips}>
              <Chip label="Signature" tone="neutral" />
              <Chip label="Photo" tone="neutral" />
            </View>
          </DetailRow>

          {task.clientReference ? (
            <DetailRow icon="link" label="External ID" value={task.clientReference} mono />
          ) : null}

          {task.generalNote ? (
            <DetailRow icon="file-text" label="Task description" value={task.generalNote} last />
          ) : (
            <DetailRow icon="user" label="Assigned to" value={task.driver?.name ?? '—'} last />
          )}
        </Card>

        {task.proofs.length > 0 ? (
          <>
            <SectionLabel style={styles.sectionLabel}>Proof captured</SectionLabel>
            <Card style={styles.detailCard}>
              {task.proofs.map((p, i) => (
                <DetailRow
                  key={p.leg}
                  icon="check-circle"
                  label={p.leg === 'PICKUP' ? 'Pickup proof' : 'Delivery proof'}
                  value={formatStamp(p.capturedAt)}
                  mono
                  last={i === task.proofs.length - 1}
                  onPress={() => router.push(`/task/${task.id}/complete?leg=${p.leg}&view=1`)}
                />
              ))}
            </Card>
          </>
        ) : null}

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
          <PrimaryButton
            label={plan.kind === 'none' ? 'Back to my tasks' : plan.label}
            icon={plan.kind === 'proof' ? 'camera' : plan.kind === 'none' ? 'check' : 'arrow-right'}
            loading={changeStatus.isPending}
            onPress={advance}
          />
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
  const ref = useRef<MapView>(null);

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

  // Without a key the native view throws on inflate and takes the whole task
  // screen down — addresses, proof capture and status all go with it. Dropping
  // just the map keeps the screen usable.
  if (!mapsConfigured) {
    return (
      <MapPlaceholder
        style={styles.map}
        title={MAPS_UNCONFIGURED_TITLE}
        detail={MAPS_UNCONFIGURED_DETAIL}
      />
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
        scrollEnabled={false}
        zoomEnabled={false}
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

  map: { height: 196, backgroundColor: '#E4E7EC' },
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

  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14 },
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
});
