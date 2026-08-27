import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as endpoints from '@/api/endpoints';
import type { ChatMessage, ChatMessagesPage } from '@/api/types';
import { env } from '@/lib/env';
import * as demoChat from './demoChat';

/**
 * Chat data.
 *
 * Two rules from the server shape everything here:
 *
 *  - **`clientMessageId` belongs to the ATTEMPT, not the request.** There is a
 *    unique index on (conversationId, clientMessageId), so resending with the
 *    same id returns the original message rather than a duplicate. Minting a new
 *    one per retry would double-post from a van with one bar, which is exactly
 *    the situation retries exist for.
 *  - **Realtime delivery is best-effort.** The server's own broadcast swallows
 *    its failures, so the socket is an optimisation and the poll below is the
 *    guarantee. Anything that assumes the socket caught everything is wrong on
 *    the first dropped connection.
 */

export const keys = {
  conversations: ['chat', 'conversations'] as const,
  messages: (conversationId: string) => ['chat', 'messages', conversationId] as const,
  attachment: (conversationId: string, messageId: string) =>
    ['chat', 'attachment', conversationId, messageId] as const,
};

/** The thread list, and the unread total the tab badge reads. */
export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: () =>
      env.demo ? demoChat.listConversations() : endpoints.listConversations(),
    // A slow poll under the socket: cheap, and the only thing that makes a
    // missed broadcast self-correcting.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

/**
 * One thread's history, newest first.
 *
 * Not paginated in the UI yet — the first page is 50 messages, which is far more
 * than a shift's worth of dispatch traffic. `meta.nextCursor` is carried through
 * so adding "load earlier" later needs no change here.
 */
export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: keys.messages(conversationId ?? 'none'),
    queryFn: () =>
      env.demo
        ? demoChat.listMessages()
        : endpoints.listMessages(conversationId as string, { limit: 50 }),
    enabled: Boolean(conversationId),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Insert or replace a message in the cached page, keeping it newest-first. */
function upsertMessage(page: ChatMessagesPage | undefined, message: ChatMessage): ChatMessagesPage {
  const base = page ?? { data: [], meta: { hasMore: false, nextCursor: null } };

  /*
   * Matched on `clientMessageId` first, then `id`. The optimistic bubble has
   * only the former; the server's reply and the broadcast echo carry both — so
   * this is what collapses all three into one message instead of showing the
   * driver their own sentence three times.
   */
  const index = base.data.findIndex(
    (m) =>
      m.id === message.id ||
      (message.clientMessageId !== null && m.clientMessageId === message.clientMessageId),
  );

  if (index === -1) return { ...base, data: [message, ...base.data] };

  const next = [...base.data];
  next[index] = message;
  return { ...base, data: next };
}

export function useSendMessage(conversationId: string, senderId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ body, clientMessageId }: { body: string; clientMessageId: string }) =>
      env.demo
        ? demoChat.sendMessage(body, clientMessageId)
        : endpoints.sendMessage(conversationId, { body, clientMessageId }),

    /**
     * Show the message the instant it is sent.
     *
     * Without this the bubble does not exist until the server answers, so a
     * driver on a slow connection taps send and watches nothing happen — and
     * "Sending…" would have nothing to appear on. The placeholder carries the
     * real `clientMessageId`, which is what `upsertMessage` matches on when the
     * server's copy arrives, so the two collapse into one bubble rather than two.
     */
    onMutate: ({ body, clientMessageId }) => {
      if (!senderId) return;
      qc.setQueryData<ChatMessagesPage>(keys.messages(conversationId), (page) =>
        upsertMessage(page, {
          // Temporary; replaced by the server's id on the way back.
          id: clientMessageId,
          conversationId,
          senderId,
          type: 'TEXT',
          body,
          clientMessageId,
          createdAt: new Date().toISOString(),
          attachment: null,
        }),
      );
    },

    onSuccess: (message) => {
      qc.setQueryData<ChatMessagesPage>(keys.messages(conversationId), (page) =>
        upsertMessage(page, message),
      );
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

export function useSendAttachment(conversationId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (form: FormData) =>
      env.demo
        ? demoChat.sendAttachment(form)
        : endpoints.sendAttachment(conversationId, form),

    onSuccess: (message) => {
      qc.setQueryData<ChatMessagesPage>(keys.messages(conversationId), (page) =>
        upsertMessage(page, message),
      );
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

/**
 * Signed links for one attachment.
 *
 * Fetched on demand rather than with the thread: the URLs expire in minutes, so
 * prefetching them for a screenful of images would mostly mint links that are
 * dead before anyone taps them. Cached briefly, well inside their lifetime.
 */
export function useAttachmentLinks(conversationId: string, messageId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.attachment(conversationId, messageId),
    queryFn: () =>
      env.demo
        ? demoChat.getAttachmentLinks(messageId)
        : endpoints.getAttachmentLinks(conversationId, messageId),
    enabled,
    staleTime: 60_000,
    gcTime: 120_000,
    retry: 1,
  });
}

/**
 * Mark read up to a message the driver has actually seen.
 *
 * Deliberately takes the newest RENDERED message rather than an implicit "now",
 * which is the server's own rule — marking past messages nobody looked at is how
 * an unread badge stops meaning anything.
 */
export function useMarkRead(conversationId: string | undefined) {
  const qc = useQueryClient();

  return useCallback(
    (lastMessageId: string | undefined) => {
      if (!conversationId || !lastMessageId || env.demo) return;

      void endpoints
        .markRead(conversationId, lastMessageId)
        .then(() => qc.invalidateQueries({ queryKey: keys.conversations }))
        // A failed read receipt is not worth a word to the driver: the badge is
        // stale for one poll and corrects itself.
        .catch(() => undefined);
    },
    [conversationId, qc],
  );
}

/** A fresh id per ATTEMPT. Reused across retries — see the note at the top. */
export const newClientMessageId = (): string => Crypto.randomUUID();
