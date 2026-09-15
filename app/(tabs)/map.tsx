import { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueries } from '@tanstack/react-query';
import {
  MapView,
  Marker,
  PROVIDER_DEFAULT,
  type MapViewHandle,
  type Region,
} from '@/components/maps';

import { getTask } from '@/api/endpoints';
import type { TaskDetail } from '@/api/types';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Body, Display, Tiny } from '@/components/Text';
import { isPickupDone, STATUS_LABELS } from '@/features/tasks/statusFlow';
import { keys, useMyTasks } from '@/features/tasks/queries';
import { useNow } from '@/lib/clock';
import { formatWindow } from '@/lib/format';
import { color, font, radius, shadow } from '@/theme/tokens';

/**
 * The whole run on one map.
 *
 * Coordinates only exist on the DETAIL endpoint — the driver's list projection
 * omits them — so this fans out one read per job. That is deliberate rather than
 * wasteful: the reads are cached under the same keys the Task screen uses, so
 * opening a job from here is instant, and a driver's run is a handful of stops,
 * not a page of them.
 *
 * ## What this screen is FOR
 *
 * One question: where do I go next, and what do I do when I get there. Every
 * decision below follows from that.
 *
 * It shows ONE pin per job — the end the driver is heading to now, not both ends
 * of every job. Before the pickup proof that is the sender; after it, the
 * receiver. Drawing both would double the pins and put half of them at places
 * the driver has already been or has no reason to visit yet.
 */

/**
 * Collect or drop — the only distinction that changes what the driver does on
 * arrival.
 *
 * Green and red, and the same two on the pins as in the header, so the legend
 * teaches the map rather than sitting beside it.
 *
 * A pin carries ONE meaning: what the stop is. Nothing else is allowed to
 * repaint or outline it, because a late collection tinted red would simply read
 * as a delivery. Lateness is said in words on the card instead — "Late · 09:00
 * → 11:00" — where it cannot be confused with a category.
 */
const KIND = {
  pick: {
    label: 'P',
    color: color.success,
    soft: color.successSoft,
    text: color.successText,
    /*
     * "Collect from", not "Pickup". The word on the pin has to survive being
     * read at a junction by someone whose first language may not be English, and
     * a verb says what to do where a noun only names a category.
     */
    verb: 'Collect from',
    legend: 'Collect',
  },
  drop: {
    label: 'D',
    color: color.danger,
    soft: color.dangerSoft,
    text: color.dangerText,
    verb: 'Deliver to',
    legend: 'Deliver',
  },
};

type Kind = keyof typeof KIND;

interface Stop {
  id: string;
  orderNo: string;
  status: TaskDetail['status'];
  kind: Kind;
  name: string;
  line: string;
  window: string;
  late: boolean;
  coordinate: { latitude: number; longitude: number };
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapViewHandle>(null);
  const now = useNow();

  /*
   * Card width follows the screen instead of being a fixed 236.
   *
   * On a 320dp phone a fixed card left almost no map visible beside it; on a
   * tablet it looked like a stamp. Reading from `useWindowDimensions` also means
   * this re-runs on rotation, which a constant cannot. Clamped at both ends so
   * the card never becomes unreadably narrow or absurdly wide.
   */
  const { width: screenW } = useWindowDimensions();
  const cardWidth = Math.round(Math.min(280, Math.max(210, screenW * 0.68)));

  const { data: tasks, isLoading: listLoading, isError, error, refetch } = useMyTasks(false);

  const details = useQueries({
    queries: (tasks ?? []).map((t) => ({
      queryKey: keys.task(t.id),
      queryFn: () => getTask(t.id),
      staleTime: 60_000,
    })),
  });

  const loaded = details.filter((d) => d.data).map((d) => d.data as TaskDetail);
  const loading = listLoading || details.some((d) => d.isLoading);

  /** The stop the driver is heading to next on each job — not both ends of each. */
  const stops = useMemo<Stop[]>(
    () =>
      loaded
        .map((task): Stop | null => {
          const goingToDelivery = isPickupDone(task.status);
          const end = goingToDelivery ? task.receiver : task.sender;
          if (end.lat == null || end.lng == null) return null;

          // The deadline that applies to the leg being driven, not the job's
          // outer span — a driver on the pickup leg is judged on the pickup.
          const due = goingToDelivery ? task.deliverBefore : task.pickupBefore;

          return {
            id: task.id,
            orderNo: task.orderNo,
            status: task.status,
            kind: goingToDelivery ? 'drop' : 'pick',
            name: end.name,
            line: `${end.line1}, ${end.city}`,
            window: goingToDelivery
              ? formatWindow(task.deliverAfter, task.deliverBefore)
              : formatWindow(task.pickupAfter, task.pickupBefore),
            late: new Date(due).getTime() < now,
            coordinate: { latitude: end.lat, longitude: end.lng },
          };
        })
        .filter((s): s is Stop => s !== null),
    [loaded, now],
  );

  const counts = useMemo(
    () => ({
      pick: stops.filter((s) => s.kind === 'pick').length,
      drop: stops.filter((s) => s.kind === 'drop').length,
      late: stops.filter((s) => s.late).length,
    }),
    [stops],
  );

  /** Frames every stop. Recomputed from the stops so "Show all" always fits them. */
  const region = useMemo<Region | null>(() => {
    if (stops.length === 0) return null;

    const lats = stops.map((s) => s.coordinate.latitude);
    const lngs = stops.map((s) => s.coordinate.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      // A floor on the span so one stop, or two in the same block, does not zoom
      // in to a texture-less grey square.
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.03),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.03),
    };
  }, [stops]);

  const header = (
    <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
      <Display style={styles.title}>My run</Display>
      {/*
        Counted in the two words that mean something on arrival, rather than "5
        stops with map pins" — which tells a driver nothing they can act on.
      */}
      <View style={styles.legend}>
        <LegendChip kind="pick" count={counts.pick} />
        <LegendChip kind="drop" count={counts.drop} />
        {counts.late > 0 ? (
          <View style={[styles.chip, styles.lateChip]}>
            <Icon name="alert-triangle" size={12} color={color.warn} />
            <Tiny style={styles.lateChipText} numberOfLines={1}>
              {counts.late} late
            </Tiny>
          </View>
        ) : null}
      </View>
    </View>
  );

  if (isError) {
    return (
      <View style={styles.screen}>
        {header}
        <ErrorState error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  if (loading && stops.length === 0) {
    return (
      <View style={styles.screen}>
        {header}
        <LoadingState label="Plotting your stops…" />
      </View>
    );
  }

  if (!region) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="map"
          title={tasks?.length ? 'No stops to plot' : 'Nothing on your run'}
          message={
            tasks?.length
              ? 'None of your open jobs have map pins yet. Open a job and use Navigate — it falls back to the address.'
              : 'Jobs appear here as soon as dispatch assigns them to you.'
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}

      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton
      >
        {stops.map((stop) => {
          const kind = KIND[stop.kind];
          return (
            <Marker
              key={stop.id}
              coordinate={stop.coordinate}
              label={kind.label}
              pinColor={kind.color}
              title={`${kind.verb} ${stop.name}`}
              description={`${stop.line}\n${stop.orderNo} · ${STATUS_LABELS[stop.status]}`}
              onCalloutPress={() => router.push(`/task/${stop.id}`)}
            />
          );
        })}
      </MapView>

      {/*
        One stacked overlay, so "Show all" sits above the cards by LAYOUT rather
        than by a guessed offset. It used to be pinned at `bottom: 186`, a number
        that only held while a card happened to be that tall — turn the OS text
        size up and the button landed on top of the strip.

        `box-none` lets taps fall through the empty area to the map underneath;
        without it this transparent container would swallow every pan and pin
        tap in the bottom third of the screen.
      */}
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show all stops"
          onPress={() => mapRef.current?.animateToRegion(region, 350)}
          style={({ pressed }) => [styles.showAll, pressed ? { opacity: 0.8 } : null]}
          hitSlop={6}
        >
          <Icon name="maximize" size={15} color={color.ink} />
          <Tiny style={styles.showAllText}>Show all</Tiny>
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
          style={styles.stripWrap}
        >
          {stops.map((stop) => (
            <StopCard
              key={stop.id}
              stop={stop}
              width={cardWidth}
              onLocate={() =>
                mapRef.current?.animateToRegion(
                  { ...stop.coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 },
                  350,
                )
              }
              onOpen={() => router.push(`/task/${stop.id}`)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * One legend entry, as a self-contained chip.
 *
 * Previously a bare coloured circle beside loose text, which had no padding of
 * its own and sat at whatever height the line box gave it. A chip owns its
 * spacing, so it cannot drift out of line with the one next to it, and it wraps
 * as a single unit when the row runs out of width.
 */
function LegendChip({ kind, count }: { kind: Kind; count: number }) {
  const k = KIND[kind];
  return (
    <View style={[styles.chip, { backgroundColor: k.soft }]}>
      <View style={[styles.chipPin, { backgroundColor: k.color }]}>
        <Tiny style={styles.chipPinText} maxFontSizeMultiplier={1}>
          {k.label}
        </Tiny>
      </View>
      <Tiny style={[styles.chipText, { color: k.text }]} numberOfLines={1}>
        {count} to {k.legend.toLowerCase()}
      </Tiny>
    </View>
  );
}

/**
 * One stop, as a card under the map.
 *
 * The whole card opens the job and a separate button centres the map. That is
 * the reverse of what this screen did before, where tapping centred the map and
 * a LONG PRESS opened the job — a gesture with no affordance, which a driver
 * would have to be told about to ever find.
 */
function StopCard({
  stop,
  width,
  onLocate,
  onOpen,
}: {
  stop: Stop;
  width: number;
  onLocate: () => void;
  onOpen: () => void;
}) {
  const kind = KIND[stop.kind];

  return (
    <View style={[styles.card, { width }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${kind.verb} ${stop.name}, ${stop.orderNo}. Opens the job.`}
        onPress={onOpen}
        style={({ pressed }) => [styles.cardBody, pressed ? styles.cardPressed : null]}
      >
        <View style={styles.cardHead}>
          <View style={[styles.cardPin, { backgroundColor: kind.color }]}>
            <Tiny style={styles.cardPinText} maxFontSizeMultiplier={1}>
              {kind.label}
            </Tiny>
          </View>
          <Tiny style={[styles.cardVerb, { color: kind.text }]} numberOfLines={1}>
            {kind.verb.toUpperCase()}
          </Tiny>
          <Icon name="chevron-right" size={15} color={color.faint} />
        </View>

        <Body style={styles.cardName} numberOfLines={1}>
          {stop.name}
        </Body>
        <Tiny style={styles.cardLine} numberOfLines={1}>
          {stop.line}
        </Tiny>

        <View style={styles.cardFoot}>
          <Icon
            name="clock"
            size={12}
            color={stop.late ? color.warn : color.muted}
          />
          <Tiny style={[styles.cardWindow, stop.late ? styles.cardLate : null]} numberOfLines={1}>
            {stop.late ? 'Late · ' : ''}
            {stop.window}
          </Tiny>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Centre the map on ${stop.name}`}
        onPress={onLocate}
        style={({ pressed }) => [styles.locate, pressed ? styles.cardPressed : null]}
        hitSlop={4}
      >
        <Icon name="crosshair" size={14} color={color.primary} />
        <Tiny style={styles.locateText}>Show on map</Tiny>
      </Pressable>
    </View>
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
    gap: 8,
  },
  title: { fontSize: 20 },

  // `flexWrap` is the whole responsiveness story here: three chips fit a modern
  // phone, wrap to a second line on a small one or with the OS text size raised,
  // and never push the row past the edge.
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Padding on the chip, not on its contents — the old version had the circle
    // and the text as loose siblings, so neither owned the spacing and they sat
    // at whatever height the line box happened to give them.
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    // Shrinks rather than overflowing when three chips meet a narrow screen.
    flexShrink: 1,
  },
  chipPin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    // Fixed, because a circle that grows with the OS text size stops being a
    // circle — the glyph inside is capped to match.
    flexShrink: 0,
  },
  chipPinText: { color: color.onPrimary, fontFamily: font.extrabold, fontSize: 10, lineHeight: 12 },
  chipText: { fontSize: 12, fontFamily: font.bold, flexShrink: 1 },

  lateChip: { backgroundColor: color.warnSoft, paddingLeft: 9 },
  lateChipText: { color: color.warn, fontFamily: font.bold, fontSize: 12, flexShrink: 1 },

  map: { flex: 1 },

  // Anchored to the bottom and laid out as a column, so the button sits above
  // the cards because of the stacking order rather than a magic offset.
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  showAll: {
    alignSelf: 'flex-end',
    marginRight: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.95)',
    ...shadow.float,
  },
  showAllText: { fontFamily: font.bold, fontSize: 11.5, color: color.ink },

  // flexGrow:0 — a ScrollView is a flex child, and in this column it would
  // otherwise stretch to fill everything above the cards.
  stripWrap: { flexGrow: 0 },
  strip: { paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardBody: { padding: 12, gap: 2 },
  cardPressed: { backgroundColor: color.surfaceSoft },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  cardPin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPinText: { color: color.onPrimary, fontFamily: font.extrabold, fontSize: 10, lineHeight: 12 },
  cardVerb: { flex: 1, fontFamily: font.extrabold, fontSize: 10, letterSpacing: 0.6 },
  cardName: { fontFamily: font.semibold, fontSize: 14.5, color: color.ink },
  cardLine: { fontSize: 11.5, color: color.muted },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  cardWindow: { flex: 1, fontFamily: font.mono, fontSize: 10.5, color: color.muted },
  cardLate: { color: color.warn, fontFamily: font.monoBold },

  locate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: color.line2,
    backgroundColor: color.primarySoft,
  },
  locateText: { fontFamily: font.bold, fontSize: 11.5, color: color.primary },
});
