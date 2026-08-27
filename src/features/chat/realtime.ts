import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import type { ChatMessage, ChatMessagesPage } from '@/api/types';
import { keys } from './queries';

/**
 * The one Realtime channel this app opens.
 *
 * Delivery is broadcast-from-database, fanned out server-side to a topic per
 * user, so a client subscribes to exactly one channel — its own inbox — and
 * receives messages for every conversation it belongs to. There is nothing to
 * subscribe to per thread.
 *
 * **The socket is an optimisation, never the guarantee.** The server's
 * `realtime.send` swallows its own failures with a RAISE WARNING, so a message
 * can be committed and never broadcast. The polls in `queries.ts` are what make
 * that self-correcting; this only removes the wait. Anything written here that
 * assumes the socket saw everything is wrong on the first dropped connection —
 * hence the refetch on every (re)subscribe rather than only on the first.
 */

export const CHAT_MESSAGE_EVENT = 'chat.message.created';
export const CHAT_MEMBERSHIP_EVENT = 'chat.membership.changed';

const inboxTopic = (userId: string) => `chat:${userId}:inbox`;

export function useChatInbox(userId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId || env.demo) return;

    let channel: RealtimeChannel | null = null;
    let disposed = false;

    const attach = async () => {
      /*
       * Channel authorization is evaluated at join time against the JWT, so the
       * token has to be in place BEFORE subscribe() — not after. A private topic
       * joined without it fails the Postgres policy and retries in a loop.
       */
      await supabase.realtime.setAuth();
      if (disposed) return;

      channel = supabase
        .channel(inboxTopic(userId), { config: { private: true } })
        .on('broadcast', { event: CHAT_MESSAGE_EVENT }, (envelope) => {
          const message = (envelope as { payload?: ChatMessage }).payload;
          if (!message) return;

          /*
           * Written straight into the cache rather than triggering a refetch:
           * the broadcast payload is byte-identical to the REST DTO by design
           * (the server asserts it in a test), so it is already the object the
           * thread renders. Refetching here would add a round trip to the one
           * path where speed is the entire point.
           */
          qc.setQueryData<ChatMessagesPage>(keys.messages(message.conversationId), (page) => {
            const base = page ?? { data: [], meta: { hasMore: false, nextCursor: null } };

            const index = base.data.findIndex(
              (m) =>
                m.id === message.id ||
                (message.clientMessageId !== null &&
                  m.clientMessageId === message.clientMessageId),
            );
            if (index !== -1) {
              // Our own message coming back, or a duplicate broadcast.
              const next = [...base.data];
              next[index] = message;
              return { ...base, data: next };
            }
            return { ...base, data: [message, ...base.data] };
          });

          // The sidebar's preview line and unread count are server-computed.
          void qc.invalidateQueries({ queryKey: keys.conversations });
        })
        .on('broadcast', { event: CHAT_MEMBERSHIP_EVENT }, () => {
          /*
           * A driver cannot open a conversation — dispatch does. Being added
           * writes a member row and no message, so without this the new thread
           * stays invisible until the next poll. Removal is the mirror case.
           */
          void qc.invalidateQueries({ queryKey: keys.conversations });
        })
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;

          /*
           * Fires on the FIRST join and on every reconnect, and both need this.
           * A phone that spent ten minutes in a basement comes back with a
           * happily SUBSCRIBED channel and a ten-minute hole in the thread —
           * nothing replays what was missed while the socket was down.
           */
          void qc.invalidateQueries({ queryKey: keys.conversations });
          void qc.invalidateQueries({ queryKey: ['chat', 'messages'] });
        });
    };

    void attach();

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'TOKEN_REFRESHED') return;
      /*
       * Authorization is cached for the life of the connection and the client is
       * dropped when its JWT expires unless a fresh one is pushed. Take the token
       * from the event payload — calling getSession() here would race the very
       * refresh being reacted to.
       */
      if (session?.access_token) void supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      disposed = true;
      authSub.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
