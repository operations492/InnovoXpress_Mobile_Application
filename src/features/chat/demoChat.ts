import type {
  ChatAttachmentLinks,
  ChatConversationsResponse,
  ChatMessage,
  ChatMessagesPage,
} from '@/api/types';
import { DISPATCH, DRIVER_ID, seedMessages } from './fixtures';

/**
 * Chat in demo mode.
 *
 * Kept because demo mode exists to review the design without infrastructure, and
 * a Chat tab that says "no conversations" reviews nothing. The shapes returned
 * here are the API's own, so the screens cannot tell the difference — which is
 * the point: what you look at in demo is what runs against the server.
 *
 * Module-level state, so it survives navigating away from the tab and resets on
 * reload. Nothing is persisted; see `useChat`'s note on why a half-real chat
 * that survives restarts is worse than one that does not.
 */

let messages: ChatMessage[] = [...seedMessages];

export function listConversations(): Promise<ChatConversationsResponse> {
  const newest = messages[messages.length - 1];

  return Promise.resolve({
    data: [
      {
        id: DISPATCH.conversationId,
        type: 'DIRECT',
        name: DISPATCH.participant.name,
        description: null,
        counterpart: {
          id: DISPATCH.participant.id,
          name: DISPATCH.participant.name,
          email: 'dispatch@innovoxpress.com',
          role: 'operator',
        },
        memberCount: 2,
        unreadCount: 0,
        lastReadAt: null,
        lastMessageAt: newest?.createdAt ?? null,
        lastMessage: newest
          ? {
              id: newest.id,
              senderId: newest.senderId,
              body: newest.body,
              createdAt: newest.createdAt,
            }
          : null,
      },
    ],
    meta: { totalUnread: 0 },
  });
}

/** Newest first, matching the real endpoint's ordering. */
export function listMessages(): Promise<ChatMessagesPage> {
  return Promise.resolve({
    data: [...messages].reverse(),
    meta: { hasMore: false, nextCursor: null },
  });
}

export function sendMessage(body: string, clientMessageId: string): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: clientMessageId,
    conversationId: DISPATCH.conversationId,
    senderId: DRIVER_ID,
    type: 'TEXT',
    body,
    clientMessageId,
    createdAt: new Date().toISOString(),
    attachment: null,
  };
  messages = [...messages, message];
  return Promise.resolve(message);
}

export function sendAttachment(form: FormData): Promise<ChatMessage> {
  // Read back what the screen put in, so the bubble reflects the real file.
  const clientMessageId = String(form.get('clientMessageId') ?? crypto.randomUUID());
  const caption = form.get('body');
  const file = form.get('file') as { name?: string; type?: string } | null;

  const message: ChatMessage = {
    id: clientMessageId,
    conversationId: DISPATCH.conversationId,
    senderId: DRIVER_ID,
    type: 'TEXT',
    body: typeof caption === 'string' && caption ? caption : null,
    clientMessageId,
    createdAt: new Date().toISOString(),
    attachment: {
      name: file?.name ?? 'photo.jpg',
      mime: file?.type ?? 'image/jpeg',
      bytes: 0,
      isImage: true,
    },
  };
  messages = [...messages, message];
  return Promise.resolve(message);
}

/**
 * No link to give: nothing was uploaded anywhere. Rejecting is more honest than
 * a placeholder image, and the bubble already handles a link that will not load.
 */
export function getAttachmentLinks(messageId: string): Promise<ChatAttachmentLinks> {
  return Promise.reject(
    new Error(`Demo mode stores no files, so ${messageId} has nothing to open.`),
  );
}
