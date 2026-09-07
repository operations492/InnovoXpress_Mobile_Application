import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo config as code, not JSON, so the permission strings sit beside the
 * plugins that need them.
 *
 * There is no map key here any more. The maps are Leaflet over OpenStreetMap
 * tiles in a WebView (`src/components/maps.tsx`), which needs no key, no billing
 * account and no native module — the same stack the dispatcher console draws
 * with.
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
    /**
     * An explicit list REPLACES Expo's defaults rather than adding to them, so
     * anything a module needs has to appear here by name. That is the trade for
     * keeping the install prompt honest — and it is how the app ended up
     * crashing on launch with:
     *
     *   IllegalArgumentException: Error: requested job be persisted without
     *   holding RECEIVE_BOOT_COMPLETED permission
     *       at expo.modules.taskManager.TaskManagerUtils.updateOrScheduleJob
     *       at expo.modules.location.taskConsumers.LocationTaskConsumer
     *       at expo.modules.taskManager.TaskBroadcastReceiver.onReceive
     *
     * `expo-task-manager` delivers every background location fix through a
     * JobScheduler job built with `setPersisted(true)`, and Android refuses a
     * persisted job to an app without RECEIVE_BOOT_COMPLETED. Because the throw
     * lands inside a BroadcastReceiver, it kills the process before a single
     * line of JavaScript runs — which is why it looked like the app closed
     * before it opened, with nothing in the Metro logs.
     *
     * Worse, it self-perpetuates: the location service outlives the app
     * (`killServiceOnDestroy: false`), so a fix is always waiting to be
     * delivered and every relaunch dies the same way.
     */
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      // Required by expo-task-manager's persisted job — see above. It is not a
      // request to run at boot; nothing in this app listens for that broadcast.
      'RECEIVE_BOOT_COMPLETED',
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
  },

  web: { favicon: './assets/favicon.png', bundler: 'metro' },

  extra: { ...config.extra },

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
