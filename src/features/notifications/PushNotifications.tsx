import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { keys as chatKeys } from '@/features/chat/queries';
import { keys } from '@/features/tasks/queries';
import { env } from '@/lib/env';
import { useAuth } from '@/state/AuthProvider';
import { ensureChannels, register, type PushData } from './push';

/**
 * Everything that happens *because* a notification exists: registering this
 * phone, refreshing the list when one lands, and opening the right screen when
 * the driver taps it.
 *
 * Renders nothing. It is a component rather than a hook called from the layout
 * so that it can be mounted at one precise point in the tree — inside the auth
 * gate (there is no token to register before that) and inside the location gate
 * (so the notification prompt queues behind the location one instead of racing
 * it; two OS dialogs stacked on a cold start is how a driver ends up denying
 * both).
 *
 * Unregistering is deliberately NOT here. It has to happen while the token is
 * still valid, which is a moment only `AuthProvider.signOut` can see — by the
 * time this component unmounts the session is already gone.
 */
export function PushNotifications() {
  const { session } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const userId = session?.user.id ?? null;

  /*
   * Registration is per USER, not per mount.
   *
   * The session object is replaced on every silent token refresh — roughly
   * hourly through a shift — and re-registering on each one would be a pointless
   * round trip. Keying on the user id also covers the case that matters on a
   * handed-over handset: a different driver signing in DOES re-register, so the
   * server's row follows whoever is actually holding the phone.
   */
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || env.demo) return;
    if (registeredFor.current === userId) return;
    registeredFor.current = userId;

    void (async () => {
      // Channels first: Android reads the channel when the notification is
      // posted, so one that arrives before the channel exists lands in a
      // default-importance fallback and never shows a heads-up banner.
      await ensureChannels();
      await register();
    })();
  }, [userId]);

  // A sign-out must let the next sign-in register again, even if it is the same
  // driver — their token was just cleared on the server.
  useEffect(() => {
    if (!userId) registeredFor.current = null;
  }, [userId]);

  /*
   * A notification arriving means the server changed something we are caching.
   *
   * This is the part that makes push more than a buzz: the driver taps the
   * banner away, opens the app an hour later, and the list is already right
   * because the arrival invalidated it. Only for a foreground arrival — iOS does
   * not run JS for a background alert, which is fine, since the app refetches on
   * focus anyway.
   */
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = (notification.request.content.data ?? {}) as PushData;

      if (data.kind === 'chat-message') {
        void qc.invalidateQueries({ queryKey: chatKeys.conversations });
        if (data.conversationId) {
          void qc.invalidateQueries({ queryKey: chatKeys.messages(data.conversationId) });
        }
        return;
      }

      void qc.invalidateQueries({ queryKey: keys.tasks });
    });
    return () => sub.remove();
  }, [qc]);

  /*
   * The tap.
   *
   * Two paths reach the same routing, and both are needed: the listener fires
   * when the app was already running, and `getLastNotificationResponseAsync`
   * covers the cold start, where the tap happened before any JS existed to hear
   * it. That call keeps returning the same response for the life of the process,
   * so a handled identifier is remembered rather than routed to twice.
   */
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);

      const data = (response.notification.request.content.data ?? {}) as PushData;

      if (data.kind === 'chat-message' && data.conversationId) {
        void qc.invalidateQueries({ queryKey: chatKeys.conversations });
        void qc.invalidateQueries({ queryKey: chatKeys.messages(data.conversationId) });
        router.push(`/chat/${data.conversationId}`);
        return;
      }

      // The list is stale by definition — the notification exists because it
      // changed. Refresh before navigating so the screen does not open on the
      // previous contents and then jump.
      void qc.invalidateQueries({ queryKey: keys.tasks });

      if (data.kind === 'task-assigned' && data.taskId) {
        void qc.invalidateQueries({ queryKey: keys.task(data.taskId) });
        router.push(`/task/${data.taskId}`);
        return;
      }

      // A bulk assign, or anything this build does not recognise — a newer
      // server must never strand the driver on whatever screen they were on.
      router.push('/');
    };

    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (active && last) open(last);
    });

    const sub = Notifications.addNotificationResponseReceivedListener(open);

    return () => {
      active = false;
      sub.remove();
    };
  }, [qc, router]);

  return null;
}
