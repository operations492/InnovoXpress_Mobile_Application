import { forwardRef, useImperativeHandle } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { MapPlaceholder } from './MapPlaceholder';

/**
 * Web stand-in for the native map.
 *
 * `maps.tsx` runs Leaflet inside a `react-native-webview`. In a browser that is
 * a WebView wrapping a WebView — the sensible web answer is Leaflet mounted
 * directly on the DOM, which is what the dispatcher console already does. Until
 * something on web actually needs a map, a placeholder is the honest stand-in.
 *
 * Metro is pointed here by `metro.config.js`. It would normally pick a `.web`
 * file automatically, but both screens import through the `@/` tsconfig alias
 * and Metro skips platform extensions when resolving those.
 */

export const PROVIDER_DEFAULT = undefined;

/** Pins and lines are drawn by the map; with no map there is nothing to draw. */
export const Marker = () => null;
export const Polyline = () => null;

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * Only the props the placeholder actually reads.
 *
 * The screens pass a dozen more (`initialRegion`, `showsUserLocation`, …) and
 * ignoring them is correct here. They still typecheck, because `tsc` does not
 * apply Metro's platform extensions — it resolves `@/components/maps` to
 * `maps.tsx` and typechecks against the native component's props.
 */
interface MapViewProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * `animateToRegion` is exposed as a no-op because the Map tab calls it on the
 * ref when a stop card is tapped — optional chaining guards a null ref, not a
 * missing method.
 */
export const MapView = forwardRef<{ animateToRegion: () => void }, MapViewProps>(
  function MapView({ style }, ref) {
    useImperativeHandle(ref, () => ({ animateToRegion: () => undefined }), []);

    return (
      <MapPlaceholder
        style={style}
        title="Map preview is not available in the browser"
        detail="Open the app on a phone to see it"
      />
    );
  },
);
