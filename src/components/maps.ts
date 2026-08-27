/**
 * The map, behind one import.
 *
 * `react-native-maps` has no web build at all — importing it from a screen is
 * what makes the browser bundle fail. Routing both screens through this module
 * lets `maps.web.tsx` stand in on web, and keeps the native path completely
 * untouched.
 */
export { default as MapView, Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
export type { Region } from 'react-native-maps';
