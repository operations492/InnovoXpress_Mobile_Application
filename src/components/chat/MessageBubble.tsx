import { Pressable, StyleSheet, View } from 'react-native';
import type { ChatMessage } from '@/api/types';
import type { DeliveryState } from '@/features/chat/types';
import { formatClock } from '@/lib/format';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from '../Icon';
import { Body, Tiny } from '../Text';
import { AttachmentBubble, IMAGE_WIDTH } from './AttachmentBubble';

/**
 * One message.
 *
 * Mine on the right in the brand colour, theirs on the left on a surface — the
 * convention every messaging app uses, which is exactly why it should not be
 * reinvented here. A driver reading this at a loading dock should not have to
 * work out whose line is whose.
 *
 * `grouped` suppresses the timestamp on consecutive messages from the same
 * person within a few minutes. Repeating "09:14" down six bubbles is noise that
 * makes a thread harder to scan, not easier.
 */
export function MessageBubble({
  message,
  mine,
  grouped,
  delivery,
  conversationId,
  onRetry,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  /** Local send state; the server has no concept of it. */
  delivery?: DeliveryState;
  conversationId: string;
  onRetry: (message: ChatMessage) => void;
}) {
  // The server narrating, not a person talking — centred and quiet so it reads
  // as punctuation between exchanges rather than as somebody's message.
  if (message.type === 'SYSTEM') {
    return (
      <View style={styles.systemRow}>
        <Tiny style={styles.systemText}>{message.body}</Tiny>
      </View>
    );
  }

  const failed = delivery === 'failed';
  const sending = delivery === 'sending';

  /**
   * A photo IS the bubble.
   *
   * Drawing the usual coloured, padded bubble behind an image puts a frame
   * around every picture — and since the image already has its own rounded
   * corners, that reads as a border drawn twice. Every messaging app drops the
   * chrome for media for exactly this reason.
   *
   * A caption keeps its own background below the image, so text still sits on a
   * surface; only the picture goes edge to edge.
   */
  const isPhoto = message.attachment?.isImage === true;

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, grouped && styles.grouped]}>
      <View
        style={[
          styles.bubble,
          isPhoto
            ? styles.bubbleMedia
            : mine
              ? styles.bubbleMine
              : styles.bubbleTheirs,
          failed && styles.bubbleFailed,
          // Dimmed until the server has it: the clearest possible signal that a
          // message is still on the phone, readable at a glance from a cab.
          sending && styles.bubbleSending,
        ]}
      >
        {message.attachment ? (
          <AttachmentBubble
            conversationId={conversationId}
            messageId={message.id}
            attachment={message.attachment}
            mine={mine}
          />
        ) : null}

        {message.body ? (
          <View
            style={
              isPhoto
                ? [styles.caption, mine ? styles.bubbleMine : styles.bubbleTheirs]
                : undefined
            }
          >
            {/* The caption keeps the bubble fill behind it, so it keeps the light text too.
                The timestamp below does NOT — it sits on bare canvas. */}
            <Body style={[styles.text, mine ? styles.textMine : null]}>
              {message.body}
            </Body>
          </View>
        ) : null}

        {grouped && !failed && !sending ? null : (
          <View style={[styles.meta, isPhoto ? styles.metaMedia : null]}>
            <Tiny
              style={[styles.time, mine && !isPhoto ? styles.timeMine : null]}
            >
              {sending ? 'Sending…' : failed ? 'Not sent' : formatClock(message.createdAt)}
            </Tiny>
            {mine && !sending && !failed ? (
              <Receipt state={delivery} onMedia={isPhoto} />
            ) : null}
          </View>
        )}
      </View>

      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Message failed to send. Tap to try again."
          onPress={() => onRetry(message)}
          style={styles.retry}
        >
          <Icon name="rotate-cw" size={12} color={color.dangerText} />
          <Tiny style={styles.retryText}>Tap to retry</Tiny>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Sent / sending / failed.
 *
 * Worth the pixels on a courier's phone: messages are written underground and in
 * lifts, and without this the driver cannot tell a delivered message from one
 * still sitting on the handset — so they send it again, and dispatch reads it
 * twice.
 */
function Receipt({
  state,
  onMedia,
}: {
  state: DeliveryState | undefined;
  onMedia: boolean;
}) {
  // Outside a coloured bubble the white tick would be invisible.
  const tint = onMedia ? color.faint : color.onPrimary;
  if (state === 'sending') return <Icon name="clock" size={11} color={tint} />;
  if (state === 'failed') return <Icon name="alert-circle" size={11} color={color.dangerText} />;
  return <Icon name="check" size={11} color={tint} />;
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 14, marginTop: 10, maxWidth: '100%' },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  grouped: { marginTop: 3 },

  bubble: {
    // Never full width: a bubble that reaches both edges stops reading as a
    // bubble, and the eye loses the left/right cue that says who spoke.
    maxWidth: '82%',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: radius.lg,
    gap: 3,
  },
  bubbleMine: { backgroundColor: color.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: color.surface, borderBottomLeftRadius: 4 },
  bubbleFailed: { backgroundColor: color.dangerSoft },
  bubbleSending: { opacity: 0.55 },
  /** No padding, no fill: the photo's own corners are the bubble. */
  bubbleMedia: { padding: 0, backgroundColor: 'transparent', gap: 4, width: IMAGE_WIDTH },
  caption: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.lg,
  },
  metaMedia: { paddingHorizontal: 2 },

  text: { fontSize: 14.5, lineHeight: 20, color: color.ink },
  textMine: { color: color.onPrimary },

  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  time: { fontSize: 10.5, color: color.faint },
  timeMine: { color: color.onPrimary, opacity: 0.75 },

  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingHorizontal: 4 },
  retryText: { fontSize: 11, color: color.dangerText, fontFamily: font.medium },

  systemRow: { alignItems: 'center', marginTop: 14, paddingHorizontal: 24 },
  systemText: { fontSize: 11, color: color.faint, textAlign: 'center' },
});
