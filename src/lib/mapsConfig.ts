import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Whether a Google Maps API key was compiled into this build.
 *
 * WHY THIS EXISTS
 *
 * `react-native-maps` on Android is Google Maps, and Google Maps refuses to
 * inflate without a key. The failure is not a polite empty map — it is a native
 * throw inside `MapView.onCreate` during view attach, which React Native then
 * reports as the thoroughly unhelpful:
 *
 *   IllegalStateException: addViewAt: failed to insert view [662] into parent [14]
 *   Caused by: IllegalStateException: API key not found.
 *
 * A JS error boundary cannot catch that — it happens on the Android UI thread,
 * not in render — so the only way to survive a missing key is to never mount the
 * view in the first place. Hence a check rather than a try/catch.
 *
 * WHERE THE VALUE COMES FROM
 *
 * The key is BUILD-TIME native config: `app.config.ts` puts it in
 * AndroidManifest / Info.plist, so unlike the `EXPO_PUBLIC_*` values in `env.ts`
 * it cannot be read from `process.env` at runtime. `app.config.ts` therefore
 * also publishes a plain boolean under `extra`, which `expo-constants` hands
 * back here.
 *
 * CAVEAT WORTH KNOWING
 *
 * With a dev client, `extra` is served by Metro and so reflects your CURRENT
 * `.env` — while the manifest reflects the last native build. Adding the key and
 * only restarting Metro would flip this flag to `true` while the compiled
 * manifest still has no key, and the crash would come back. Adding the key
 * always requires a native rebuild (`npx expo run:android`), which puts the two
 * back in step.
 */
const extra = Constants.expoConfig?.extra as { googleMapsKey?: { android?: boolean } } | undefined;

export const mapsConfigured = Platform.select({
  // Android IS Google Maps, and Google Maps refuses to inflate without a key.
  android: extra?.googleMapsKey?.android ?? false,
  /*
   * Always true on iOS. Both screens pass `PROVIDER_DEFAULT`, which on iOS means
   * Apple Maps — no key, no billing account, nothing to configure. A Google key
   * would only matter under `PROVIDER_GOOGLE`, which this app never asks for.
   */
  ios: true,
  // The web bundle never reaches here — `maps.web.tsx` stands in first.
  default: false,
});

/** Shown in the placeholder, so a blank map explains itself instead of looking broken. */
export const MAPS_UNCONFIGURED_TITLE = 'Map unavailable';
export const MAPS_UNCONFIGURED_DETAIL = 'No Google Maps API key in this build';
