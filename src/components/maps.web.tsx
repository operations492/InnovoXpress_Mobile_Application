import { forwardRef, useImperativeHandle } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { MapPlaceholder } from './MapPlaceholder';

/**
 * Web stand-in for `react-native-maps`, which ships no web implementation — its
 * entry calls `codegenNativeComponent`, which `react-native-web` does not
 * export, so merely importing it throws.
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
 * `maps.ts` and therefore to the real `react-native-maps` types.
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
