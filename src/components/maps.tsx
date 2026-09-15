import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

import { color } from '@/theme/tokens';

/**
 * The map — Leaflet and OpenStreetMap tiles, in a WebView.
 *
 * WHY NOT `react-native-maps`
 *
 * On Android that component IS Google Maps, and Google Maps refuses to inflate
 * without an API key: a native throw on the UI thread that no JS error boundary
 * can catch. Getting a key means a Google Cloud project with billing enabled,
 * and a key shipped in an APK has to be restricted by package name and SHA-1 or
 * it is simply scraped. That is a lot of ceremony for two pins and a dashed
 * line — and the dispatcher console already draws its maps with Leaflet against
 * `tile.openstreetmap.org`, so this also makes the two halves of the product
 * agree with each other.
 *
 * WHY A WEBVIEW IS ENOUGH HERE
 *
 * Neither screen asks for much. The task screen draws two pins and a straight
 * dashed line into a 196px strip with every gesture disabled; the map tab draws
 * one pin per stop and flies to one when a card is tapped. A vector-tile native
 * renderer would be better for a map you pan around all day, and worse for this:
 * it is another native module, another rebuild, and another dependency to keep
 * in step with the SDK. `react-native-webview` is already in the build for the
 * signature pad, so this adds nothing to compile.
 *
 * THE API IS `react-native-maps`'s, DELIBERATELY
 *
 * Same component names, same prop names, same `animateToRegion` on the ref. The
 * screens did not change when this replaced it, and if the trade-offs ever point
 * back to a native renderer, they will not change then either.
 */

/** Kept so the screens' `provider={PROVIDER_DEFAULT}` still reads sensibly. */
export const PROVIDER_DEFAULT = undefined;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

// ---------------------------------------------------------------------------
// Children as configuration
// ---------------------------------------------------------------------------

/**
 * `Marker` and `Polyline` render nothing.
 *
 * They exist so a screen can describe what is on the map in JSX — which is how
 * `react-native-maps` reads, and how anyone coming to these screens expects it
 * to read. `MapView` walks its children, turns them into plain data and sends
 * that across the bridge; the elements themselves never reach the tree.
 */

export interface MarkerProps {
  coordinate: LatLng;
  title?: string;
  description?: string;
  /** Any colour string; it is handed to CSS, not to a native pin palette. */
  pinColor?: string;
  /**
   * One or two characters drawn inside the pin.
   *
   * Colour alone cannot say what a stop IS — it has to be learned from a legend
   * and is invisible to a colour-blind driver. A letter is read directly.
   */
  label?: string;
  onCalloutPress?: () => void;
}

export function Marker(_props: MarkerProps): null {
  return null;
}
Marker.displayName = 'IXMarker';

export interface PolylineProps {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  /** `[dash, gap]`, matching the native prop. Anything else is drawn solid. */
  lineDashPattern?: number[];
}

export function Polyline(_props: PolylineProps): null {
  return null;
}
Polyline.displayName = 'IXPolyline';

interface MarkerSpec {
  id: string;
  lat: number;
  lng: number;
  title: string | null;
  description: string | null;
  color: string;
  label: string | null;
  tappable: boolean;
}

interface LineSpec {
  points: [number, number][];
  color: string;
  width: number;
  dash: string | null;
}

function readChildren(children: ReactNode): {
  markers: MarkerSpec[];
  lines: LineSpec[];
  handlers: Map<string, () => void>;
} {
  const markers: MarkerSpec[] = [];
  const lines: LineSpec[] = [];
  const handlers = new Map<string, () => void>();

  Children.toArray(children).forEach((child, index) => {
    if (!isValidElement(child)) return;
    const name = (child.type as { displayName?: string })?.displayName;

    if (name === 'IXMarker') {
      const p = child.props as MarkerProps;
      // The React key when there is one, so a marker keeps its identity across
      // re-renders and the WebView is not told to rebuild every pin each time.
      const id = child.key != null ? String(child.key) : `m${index}`;
      if (p.onCalloutPress) handlers.set(id, p.onCalloutPress);
      markers.push({
        id,
        lat: p.coordinate.latitude,
        lng: p.coordinate.longitude,
        title: p.title ?? null,
        description: p.description ?? null,
        color: p.pinColor ?? color.primary,
        label: p.label ?? null,
        tappable: Boolean(p.onCalloutPress),
      });
      return;
    }

    if (name === 'IXPolyline') {
      const p = child.props as PolylineProps;
      lines.push({
        points: p.coordinates.map((c) => [c.latitude, c.longitude]),
        color: p.strokeColor ?? color.primary,
        width: p.strokeWidth ?? 3,
        dash: p.lineDashPattern?.length ? p.lineDashPattern.join(' ') : null,
      });
    }
  });

  return { markers, lines, handlers };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * Leaflet comes from a CDN rather than being inlined.
 *
 * Inlining ~140KB of library into a JS string would bloat the bundle for a
 * screen most drivers open a few times a day, and buys nothing: the tiles are a
 * network fetch regardless, so a map without a connection is a grey square
 * either way.
 *
 * Pinned to an exact version. A floating major would let someone else's release
 * change what this app draws.
 */
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

/**
 * The same tile server and attribution the dispatcher console uses.
 *
 * Attribution is not decoration — it is the condition OpenStreetMap's data is
 * licensed under, and it must stay visible.
 */
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; OpenStreetMap contributors';

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET_CSS}" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #E4E7EC; }
  .leaflet-container { background: #E4E7EC; font-family: -apple-system, Roboto, sans-serif; }
  /* The pin: a filled dot with a white ring, so it reads on any tile. */
  .ix-pin {
    width: 16px; height: 16px; border-radius: 50%;
    border: 3px solid #fff; box-sizing: border-box;
    box-shadow: 0 1px 4px rgba(26,26,46,.45);
  }
  /*
    The labelled variant is bigger, because it has to hold a readable glyph at
    arm's length in daylight. Same ring and shadow so the two read as one family.
  */
  .ix-pin.ix-lab {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 800; font-size: 13px; line-height: 1;
    /* A dark tile under a white glyph is the one case the ring cannot save. */
    text-shadow: 0 1px 1px rgba(0,0,0,.25);
  }
  .ix-me {
    width: 14px; height: 14px; border-radius: 50%;
    background: ${color.primary}; border: 3px solid #fff; box-sizing: border-box;
    box-shadow: 0 0 0 4px ${color.primary}33;
  }
  .leaflet-popup-content { margin: 9px 12px; font-size: 13px; line-height: 1.35; }
  .ix-t { font-weight: 700; color: ${color.ink}; }
  .ix-d { color: ${color.muted}; margin-top: 2px; }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS}"></script>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer('${TILE_URL}', { attribution: '${ATTRIBUTION}', maxZoom: 19 }).addTo(map);

  var markerLayer = L.layerGroup().addTo(map);
  var lineLayer = L.layerGroup().addTo(map);
  var meMarker = null;

  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  /** Web-Mercator: one zoom level per halving of the visible longitude span. */
  function zoomFor(lngDelta) {
    if (!lngDelta || lngDelta <= 0) return 13;
    return Math.max(2, Math.min(18, Math.log2(360 / lngDelta)));
  }

  window.ixSetView = function (lat, lng, lngDelta) {
    map.setView([lat, lng], zoomFor(lngDelta));
  };

  window.ixFlyTo = function (lat, lng, lngDelta, ms) {
    map.flyTo([lat, lng], zoomFor(lngDelta), { duration: Math.max(0.1, ms / 1000) });
  };

  window.ixGestures = function (on) {
    var parts = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];
    parts.forEach(function (p) { if (map[p]) { on ? map[p].enable() : map[p].disable(); } });
    if (map.tap) { on ? map.tap.enable() : map.tap.disable(); }
  };

  window.ixSetMe = function (lat, lng) {
    if (lat === null) { if (meMarker) { map.removeLayer(meMarker); meMarker = null; } return; }
    var icon = L.divIcon({ className: '', html: '<div class="ix-me"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    if (meMarker) meMarker.setLatLng([lat, lng]);
    else meMarker = L.marker([lat, lng], { icon: icon, interactive: false, zIndexOffset: -100 }).addTo(map);
  };

  window.ixDraw = function (markers, lines) {
    markerLayer.clearLayers();
    lineLayer.clearLayers();

    markers.forEach(function (m) {
      var size = m.label ? 28 : 16;
      var cls = m.label ? 'ix-pin ix-lab' : 'ix-pin';
      var text = m.label ? String(m.label) : '';

      var icon = L.divIcon({
        className: '',
        html: '<div class="' + cls + '" style="background:' + m.color + '">' + text + '</div>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      var marker = L.marker([m.lat, m.lng], { icon: icon }).addTo(markerLayer);

      if (m.title || m.description) {
        var html = '';
        if (m.title) html += '<div class="ix-t">' + m.title + '</div>';
        if (m.description) html += '<div class="ix-d">' + m.description + '</div>';
        marker.bindPopup(html);
      }
      if (m.tappable) {
        // The popup is the callout, so tapping it is the callout press.
        marker.on('popupopen', function (e) {
          e.popup.getElement().addEventListener('click', function () {
            post({ type: 'callout', id: m.id });
          });
        });
      }
    });

    lines.forEach(function (l) {
      L.polyline(l.points, {
        color: l.color,
        weight: l.width,
        dashArray: l.dash || undefined,
      }).addTo(lineLayer);
    });
  };

  post({ type: 'ready' });
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// MapView
// ---------------------------------------------------------------------------

/** What a screen can do with a `ref` to the map. Hold it as `useRef<MapViewHandle>(null)`. */
export interface MapViewHandle {
  animateToRegion: (region: Region, duration?: number) => void;
}

export interface MapViewProps {
  style?: StyleProp<ViewStyle>;
  initialRegion?: Region | null;
  /** Draws the driver's own position. See the note on the effect below. */
  showsUserLocation?: boolean;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  children?: ReactNode;

  /*
   * Accepted and ignored. They exist so the screens keep compiling unchanged;
   * a WebView has no toolbar, no compass and no tilt to turn off.
   */
  provider?: unknown;
  showsMyLocationButton?: boolean;
  toolbarEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
}

/** How often the driver's own dot is refreshed while a map is on screen. */
const ME_REFRESH_MS = 15_000;

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    style,
    initialRegion,
    showsUserLocation = false,
    scrollEnabled = true,
    zoomEnabled = true,
    children,
  },
  ref,
) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  const { markers, lines, handlers } = useMemo(() => readChildren(children), [children]);

  /*
   * Handlers are held in a ref as well as in state.
   *
   * A message can arrive from the WebView between renders, and reading the map
   * built during the last render is how a tap ends up calling a stale closure —
   * or nothing at all, if the callback moved.
   */
  const handlerRef = useRef(handlers);
  useEffect(() => {
    handlerRef.current = handlers;
  }, [handlers]);

  const run = useCallback((js: string) => {
    // The trailing `true` is required: injectJavaScript evaluates the string and
    // a non-boolean completion value warns on iOS.
    web.current?.injectJavaScript(`${js}; true;`);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (region, duration = 350) => {
        run(
          `window.ixFlyTo(${region.latitude}, ${region.longitude}, ${region.longitudeDelta}, ${duration})`,
        );
      },
    }),
    [run],
  );

  // Initial framing, once the page says it is up. Re-run if the region changes
  // identity — the screens memoise it, so this is not every render.
  useEffect(() => {
    if (!ready || !initialRegion) return;
    run(
      `window.ixSetView(${initialRegion.latitude}, ${initialRegion.longitude}, ${initialRegion.longitudeDelta})`,
    );
  }, [ready, initialRegion, run]);

  useEffect(() => {
    if (!ready) return;
    run(`window.ixGestures(${scrollEnabled && zoomEnabled})`);
  }, [ready, scrollEnabled, zoomEnabled, run]);

  useEffect(() => {
    if (!ready) return;
    run(`window.ixDraw(${JSON.stringify(markers)}, ${JSON.stringify(lines)})`);
  }, [ready, markers, lines, run]);

  /**
   * The driver's own dot, from the LAST KNOWN position rather than a fresh fix.
   *
   * `getLastKnownPositionAsync` reads the OS cache: no GPS wake-up, no battery,
   * and it returns immediately. The app is already tracking continuously while
   * on shift, so that cache is seconds old — asking for a new fix here would
   * spend power to learn something the phone had already written down.
   */
  useEffect(() => {
    if (!ready || !showsUserLocation) return;
    let alive = true;

    const paint = async () => {
      const fix = await Location.getLastKnownPositionAsync().catch(() => null);
      if (!alive || !fix) return;
      run(`window.ixSetMe(${fix.coords.latitude}, ${fix.coords.longitude})`);
    };

    void paint();
    const timer = setInterval(() => void paint(), ME_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ready, showsUserLocation, run]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={web}
        source={{ html: HTML }}
        originWhitelist={['*']}
        style={styles.web}
        // The page is a fixed local string; nothing in it navigates anywhere.
        javaScriptEnabled
        domStorageEnabled={false}
        // Stops the WebView hijacking the parent ScrollView on the task screen.
        scrollEnabled={false}
        nestedScrollEnabled={false}
        // Android: without this the tile PNGs render on a software layer and the
        // map visibly tears while flying.
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data) as { type: string; id?: string };
            if (msg.type === 'ready') setReady(true);
            else if (msg.type === 'callout' && msg.id) handlerRef.current.get(msg.id)?.();
          } catch {
            // A message we do not understand is not worth a crash.
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { overflow: 'hidden', backgroundColor: '#E4E7EC' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
