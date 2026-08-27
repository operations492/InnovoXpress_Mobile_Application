import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo config as code, not JSON, for one reason: the Google Maps key has to come
 * out of the environment. It is build-time native config (it ends up in
 * AndroidManifest.xml), so it cannot be read at runtime the way the
 * EXPO_PUBLIC_* values in `src/lib/env.ts` are.
 *
 * Everything the driver app touches on the device needs a permission string, and
 * the store rejects a build whose strings are missing — so they are declared here
 * rather than left to the plugin defaults.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Innovo Xpress Driver',
  slug: 'innovo-driver-app',
  scheme: 'innovodriver',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  assetBundlePatterns: ['**/*'],

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.innovoxpress.driver',
    infoPlist: {
      // Background location is the shift tracker. iOS shows the "Always" prompt
      // only after "When In Use" has been granted, which is why the app asks in
      // that order (see src/features/location/tracking.ts).
      NSLocationWhenInUseUsageDescription:
        'Innovo Xpress shows dispatch where you are while you are on shift, so jobs can be routed to the nearest driver.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Innovo Xpress keeps reporting your position while you are on shift, even when the app is in the background, so dispatch can see your run in progress.',
      NSCameraUsageDescription:
        'Innovo Xpress uses the camera to photograph proof of pickup and delivery.',
      NSPhotoLibraryUsageDescription:
        'Innovo Xpress lets you attach an existing photo as proof of pickup or delivery.',
      UIBackgroundModes: ['location', 'fetch'],
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'com.innovoxpress.driver',
    adaptiveIcon: {
      backgroundColor: '#4B3FCF',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'CAMERA',
      'INTERNET',
      'ACCESS_NETWORK_STATE',
      'VIBRATE',
    ],
    /**
     * `expo-image-picker`'s plugin adds RECORD_AUDIO so that video capture works.
     * This app photographs parcels and never records anything, so the permission
     * is pure surface area: it puts the microphone on the store listing and in
     * the install prompt, and invites the obvious question at review.
     */
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    config: {
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID },
    },
  },

  web: { favicon: './assets/favicon.png', bundler: 'metro' },

  /**
   * The keys above are native build config and unreadable at runtime, but the
   * screens must know whether a map can be drawn at all: Google Maps throws on
   * inflate when the key is missing, and that crash cannot be caught from JS.
   *
   * Publishing only a BOOLEAN, never the key itself — `extra` is readable by any
   * JS in the bundle, and the key has no business being there.
   */
  extra: {
    ...config.extra,
    googleMapsKey: {
      android: Boolean(process.env.GOOGLE_MAPS_API_KEY_ANDROID),
    },
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#EFEFF5',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Innovo Xpress keeps reporting your position while you are on shift, even when the app is in the background.',
        locationWhenInUsePermission:
          'Innovo Xpress shows dispatch where you are while you are on shift.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Innovo Xpress lets you attach an existing photo as proof of pickup or delivery.',
        cameraPermission:
          'Innovo Xpress uses the camera to photograph proof of pickup and delivery.',
      },
    ],
  ],

  experiments: { typedRoutes: true },
});
