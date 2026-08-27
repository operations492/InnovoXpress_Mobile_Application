import type { ChatMessage, ChatParticipant } from '@/api/types';

/**
 * A short, plausible thread so the screen can be judged with content in it.
 *
 * Written as a real dispatch exchange rather than lorem ipsum: the layout has to
 * survive a one-word reply, a long paragraph, a run of consecutive messages from
 * the same person, and a system line — and none of those show up if the sample
 * is three tidy sentences of equal length.
 *
 * Replaced wholesale by `GET /api/chat/conversations/:id/messages` later.
 */

export const DRIVER_ID = 'me';

export const DISPATCH: {
  conversationId: string;
  participant: ChatParticipant;
} = {
  conversationId: 'dispatch',
  participant: {
    id: 'dispatch',
    name: 'Dispatch',
    email: 'dispatch@innovoxpress.com',
    role: 'operator',
  },
};

/** Minutes before now, so the thread always reads as "just happened". */
const at = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const seedMessages: ChatMessage[] = [
  {
    id: 'm1',
    conversationId: DISPATCH.conversationId,
    senderId: DISPATCH.participant.id,
    type: 'SYSTEM',
    body: 'Shift opened',
    clientMessageId: null,
    createdAt: at(196),
    attachment: null,
  },
  {
    id: 'm2',
    conversationId: DISPATCH.conversationId,
    senderId: DISPATCH.participant.id,
    type: 'TEXT',
    body: 'Morning Ali. Two extra drops going on your run — both Mississauga, near the Explorer Drive depot so they should not add much.',
    clientMessageId: null,
    createdAt: at(194),
    attachment: null,
  },
  {
    id: 'm3',
    conversationId: DISPATCH.conversationId,
    senderId: DRIVER_ID,
    type: 'TEXT',
    body: 'Got it',
    clientMessageId: null,
    createdAt: at(191),
    attachment: null,
  },
  {
    id: 'm4',
    conversationId: DISPATCH.conversationId,
    senderId: DRIVER_ID,
    type: 'TEXT',
    body: 'Gate at 696 Matheson is locked, no answer on the buzzer. Waiting five minutes then moving on?',
    clientMessageId: null,
    createdAt: at(38),
    attachment: null,
  },
  {
    id: 'm5',
    conversationId: DISPATCH.conversationId,
    senderId: DISPATCH.participant.id,
    type: 'TEXT',
    body: 'Yes, five is fine.',
    clientMessageId: null,
    createdAt: at(36),
    attachment: null,
  },
  {
    id: 'm6',
    conversationId: DISPATCH.conversationId,
    senderId: DISPATCH.participant.id,
    type: 'TEXT',
    body: 'I have called the receiver — she is on her way down. Give it two more minutes before you leave.',
    clientMessageId: null,
    createdAt: at(35),
    attachment: null,
  },
];
