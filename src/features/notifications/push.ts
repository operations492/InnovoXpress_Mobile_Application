import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import * as endpoints from '@/api/endpoints';
import { env } from '@/lib/env';
import { color } from '@/theme/tokens';

/**
 * Push notifications — telling a driver that work has landed.
 *
 * ## Why push and not a poll
 *
 * The app already polls its work list, but that poll is suspended the moment the
 * app is backgrounded (`lib/queryFocus.ts` ties TanStack Query's focus manager to
 * `AppState`, deliberately, so a phone in a pocket is not burning battery on
 * HTTP). A local notification driven by that poll would therefore fire only
 * while the driver is already looking at the screen — precisely when they do not
 * need telling. The event also originates on the server, when a dispatcher
 * assigns; only the server can know about it first.
 *
 * ## Why Expo's service and not FCM/APNs directly
 *
 * One token shape and one send call for both platforms, with EAS holding the
 * credentials. Going direct would mean a Firebase service account and an Apple
 * .p8 key wired into the backend, for identical delivery.
 */

/**
 * How a notification behaves when it arrives while the app is OPEN.
 *
 * Banners are shown rather than swallowed. The default is to suppress them in
 * the foreground, on the theory that the app is already showing the news — but
 * that is not true here: a driver reading a job's detail screen has no idea a
 * different job was just assigned, and the list behind them is not on screen.
 *
 * No sound in the foreground, though. The phone is in the driver's hand; a
 * banner is enough, and a chime while they are mid-task is just noise.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * What the server puts in `data`. Kept tiny — Expo and APNs both cap at 4KB.
 *
 * `taskId` accompanies `task-assigned` only. `task-removed` deliberately carries
 * none: the order stopped being this driver's the moment it moved, so opening it
 * would answer 403 — that tap belongs on their work list.
 *
 * Treat the union as open. A newer server may send a kind this build has never
 * heard of, and the tap handler falls through to the list rather than doing
 * nothing.
 */
export interface PushData {
  kind?: 'task-assigned' | 'tasks-assigned' | 'task-removed' | 'chat-message';
  taskId?: string;
  conversationId?: string;
}

/**
 * Android needs channels, and needs them before the first notification arrives.
 *
 * A channel is created once and then owned by the USER: importance, sound and
 * vibration become their settings, and the app cannot change them afterwards. So
 * the values below are a starting point, not a guarantee — which is also why
 * there is a separate channel per kind of interruption rather than one for
 * everything. A driver who mutes chatter must not thereby mute new work.
 *
 * Called on every launch; creating an existing channel is a no-op.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('jobs', {
    name: 'New jobs',
    description: 'When dispatch assigns you a job.',
    // MAX rather than HIGH: this is the one thing worth interrupting for, and it
    // is what gets a heads-up banner over whatever is on screen.
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: color.primary,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'Messages from dispatch.',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: color.primary,
  });
}

/**
 * Ask for permission, and report honestly whether we have it.
 *
 * Asked AFTER sign-in rather than at first launch. A permission prompt on a
 * screen that has not yet explained itself is the one most reliably denied, and
 * on iOS a denial is close to permanent — the OS will not ask twice, and the
 * only way back is Settings. By the time a driver has signed in they know what
 * the app is for.
 */
export async function requestPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  // `canAskAgain` false means the OS will silently return denied — asking again
  // costs a round trip and teaches nothing.
  if (!existing.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      // NOT `provisional`: a quiet notification delivered straight to the
      // notification centre is exactly wrong for "a job just landed".
      allowCriticalAlerts: false,
    },
  });
  return asked.granted;
}

/**
 * The Expo project id, which `getExpoPushTokenAsync` cannot work without.
 *
 * Read from either of the two places Expo has put it across SDK versions, so
 * this keeps working through an upgrade rather than failing at runtime on a
 * driver's phone.
 */
function projectId(): string | null {
  const fromEas = Constants.expoConfig?.extra?.eas?.projectId;
  const fromNew = (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  const id = (typeof fromEas === 'string' && fromEas) || (typeof fromNew === 'string' && fromNew);
  return id || null;
}

/**
 * Register this installation with the server so it can be pushed to.
 *
 * Returns silently on every failure path, because none of them is worth
 * interrupting a driver over: they are about to work whether or not the phone
 * can buzz, and the app polls its list regardless. The reasons are logged in
 * development, where somebody can act on them.
 */
export async function register(): Promise<void> {
  if (env.demo) return;

  const granted = await requestPermission();
  if (!granted) {
    if (__DEV__) console.log('[push] permission not granted — no token registered');
    return;
  }

  const id = projectId();
  if (!id) {
    if (__DEV__) {
      console.warn(
        '[push] no Expo project id. Run `eas init` — `getExpoPushTokenAsync` cannot mint a ' +
          'token without one, so push is off until it is set.',
      );
    }
    return;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await endpoints.setPushToken(token);
    if (__DEV__) console.log('[push] registered', token);
  } catch (e) {
    // A simulator, a device with no network, or a project id that does not match
    // the signed build. None of them should stop the app.
    if (__DEV__) console.warn('[push] could not register:', e);
  }
}

/**
 * Stop pushing to this phone.
 *
 * Called on sign-out, and it matters on a shared or handed-over handset: without
 * it the next driver keeps buzzing for the previous one's jobs, on a device
 * where they cannot even open the record.
 */
export async function unregister(): Promise<void> {
  if (env.demo) return;
  await endpoints.setPushToken(null).catch(() => undefined);
}
