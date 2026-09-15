import { existsSync } from 'fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Android push needs Firebase, even though nothing else here does.
 *
 * Expo's push service is a front door to FCM, not a replacement for it, so an
 * Android build has to carry the project's `google-services.json` or
 * `getExpoPushTokenAsync` fails on the device with "Default FirebaseApp is not
 * initialized". EAS Build injects it from the credentials `eas credentials`
 * uploaded; a LOCAL `npx expo run:android` has no such step, which is why the
 * file is picked up from the project root here.
 *
 * Conditional because it must not become a build-breaking dependency: prebuild
 * throws outright on a `googleServicesFile` that points at nothing, and a
 * teammate cloning this repo has no reason to be blocked from building a debug
 * APK just because push is not set up on their machine. Notifications simply do
 * not arrive until the file is present, which is the honest degradation.
 */
const googleServices = './google-services.json';
const hasGoogleServices = existsSync(googleServices);

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
  /**
   * The Expo account that owns this project, and therefore the FCM and APNs
   * credentials EAS holds for it.
   *
   * Named explicitly rather than left to default, because the default is
   * whichever account happens to be logged in — which on a machine with access
   * to two accounts silently creates a SECOND project, with its own push
   * credentials, minting tokens the other project cannot send to.
   *
   * The team rather than a person: push credentials outliving one employee's
   * account is the whole point of an organisation.
   */
  owner: 'mabdullahkhan47s-team',
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
    ...(hasGoogleServices ? { googleServicesFile: googleServices } : {}),
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
      /*
       * Android 13+. Without it the OS drops every notification silently — no
       * error, no banner, and `getPermissionsAsync` reports denied with
       * `canAskAgain: false`, so the app cannot even prompt its way out.
       *
       * It is not implied by the plugin: the explicit list above REPLACES Expo's
       * defaults, which is the same trap that cost us RECEIVE_BOOT_COMPLETED.
       */
      'POST_NOTIFICATIONS',
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
      'expo-notifications',
      {
        /*
         * Android draws the small icon as a SILHOUETTE — every non-transparent
         * pixel becomes white, whatever colour it was. Hand it the full-colour
         * launcher icon and it arrives as a white blob. The monochrome adaptive
         * asset is already a single shape on transparency, which is the same
         * thing this needs.
         */
        icon: './assets/android-icon-monochrome.png',
        // Tints the silhouette and the app name in the notification shade.
        color: '#4B3FCF',
        /*
         * Where a notification lands if the sender names no channel. It is
         * belt-and-braces — the backend always sets `channelId: 'jobs'` — but a
         * notification that misses its channel falls back to DEFAULT importance
         * and shows no heads-up banner, which for a new job is the same as not
         * arriving.
         */
        defaultChannel: 'jobs',
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
