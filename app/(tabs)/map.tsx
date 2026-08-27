import { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueries } from '@tanstack/react-query';
import { MapView, Marker, PROVIDER_DEFAULT, type Region } from '@/components/maps';
import { MapPlaceholder } from '@/components/MapPlaceholder';
import {
  MAPS_UNCONFIGURED_DETAIL,
  MAPS_UNCONFIGURED_TITLE,
  mapsConfigured,
} from '@/lib/mapsConfig';

import { getTask } from '@/api/endpoints';
import type { TaskDetail } from '@/api/types';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Body, Display, Small, Tiny } from '@/components/Text';
import { colorForStatus, isPickupDone, STATUS_LABELS } from '@/features/tasks/statusFlow';
import { keys, useMyTasks } from '@/features/tasks/queries';
import { color, font, radius, shadow } from '@/theme/tokens';

/**
 * The whole run on one map.
 *
 * Coordinates only exist on the DETAIL endpoint — the driver's list projection
 * omits them — so this fans out one read per job. That is deliberate rather than
 * wasteful: the reads are cached under the same keys the Task screen uses, so
 * opening a job from here is instant, and a driver's run is a handful of stops,
 * not a page of them.
 */
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

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
  const stops = useMemo(
    () =>
      loaded
        .map((task) => {
          const goingToDelivery = isPickupDone(task.status);
          const end = goingToDelivery ? task.receiver : task.sender;
          if (end.lat == null || end.lng == null) return null;

          return {
            id: task.id,
            orderNo: task.orderNo,
            status: task.status,
            kind: goingToDelivery ? ('drop' as const) : ('pick' as const),
            name: end.name,
            line: `${end.line1}, ${end.city}`,
            coordinate: { latitude: end.lat, longitude: end.lng },
          };
        })
        .filter(Boolean) as {
        id: string;
        orderNo: string;
        status: TaskDetail['status'];
        kind: 'pick' | 'drop';
        name: string;
        line: string;
        coordinate: { latitude: number; longitude: number };
      }[],
    [loaded],
  );

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
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.03),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.03),
    };
  }, [stops]);

  const header = (
    <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
      <Display style={styles.title}>My run</Display>
      <Small>
        {stops.length} stop{stops.length === 1 ? '' : 's'} with map pins
      </Small>
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

      {mapsConfigured ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton
        >
          {stops.map((stop) => (
            <Marker
              key={stop.id}
              coordinate={stop.coordinate}
              title={stop.name}
              description={`${stop.orderNo} · ${STATUS_LABELS[stop.status]}`}
              pinColor={colorForStatus(stop.status)}
              onCalloutPress={() => router.push(`/task/${stop.id}`)}
            />
          ))}
        </MapView>
      ) : (
        // Without a key the native view throws on inflate and takes the screen
        // down; the stop strip below still works, so only the map is dropped.
        <MapPlaceholder
          style={styles.map}
          title={MAPS_UNCONFIGURED_TITLE}
          detail={MAPS_UNCONFIGURED_DETAIL}
        />
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.strip, { paddingBottom: 12 }]}
        style={styles.stripWrap}
      >
        {stops.map((stop) => (
          <Pressable
            key={stop.id}
            accessibilityRole="button"
            accessibilityLabel={`${stop.orderNo}, ${stop.name}`}
            onPress={() => {
              mapRef.current?.animateToRegion(
                { ...stop.coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 },
                350,
              );
            }}
            onLongPress={() => router.push(`/task/${stop.id}`)}
            style={({ pressed }) => [styles.chipCard, pressed ? { opacity: 0.85 } : null]}
          >
            <View style={styles.chipHead}>
              <View
                style={[styles.chipDot, { backgroundColor: colorForStatus(stop.status) }]}
              />
              <Tiny style={styles.chipStatus} numberOfLines={1}>
                {STATUS_LABELS[stop.status]}
              </Tiny>
              <Icon
                name={stop.kind === 'drop' ? 'map-pin' : 'package'}
                size={13}
                color={color.faint}
              />
            </View>
            <Body style={styles.chipName} numberOfLines={1}>
              {stop.name}
            </Body>
            <Tiny style={styles.chipLine} numberOfLines={1}>
              {stop.line}
            </Tiny>
          </Pressable>
        ))}
      </ScrollView>
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
  },
  title: { fontSize: 20 },
  map: { flex: 1 },

  stripWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  strip: { paddingHorizontal: 14, gap: 10 },
  chipCard: {
    width: 220,
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    padding: 12,
    gap: 3,
    ...shadow.card,
  },
  chipHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipStatus: { flex: 1, fontFamily: font.bold, fontSize: 11, color: color.body },
  chipName: { fontFamily: font.semibold, fontSize: 14, color: color.ink },
  chipLine: { fontSize: 11.5, color: color.muted },
});
