import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import type { ChatAttachment } from '@/api/types';
import { useAttachmentLinks } from '@/features/chat/queries';
import { formatBytes } from '@/lib/format';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from '../Icon';
import { Small, Tiny } from '../Text';

/**
 * A file on a message.
 *
 * The message DTO carries metadata only — never a URL — because a signed link
 * expires and that shape has to stay byte-identical to the Realtime broadcast.
 * So the link is a second request, and when it is made matters:
 *
 *  - **Images fetch on mount.** They have to, to be visible at all.
 *  - **Everything else waits for a tap.** Minting links for a screenful of PDFs
 *    nobody opens produces URLs that expire unused, and each one is a round trip.
 *
 * `isImage` is the server's verdict from sniffing the actual bytes, not the
 * declared mime — a file named `.jpg` that is not one is treated as a download,
 * which is also why non-images come back with `Content-Disposition: attachment`.
 */

/** Wide enough to read a label in, narrow enough to still read as a bubble. */
export const IMAGE_WIDTH = 232;

/**
 * How far from square an image may be drawn.
 *
 * Without a floor a panorama becomes a letterbox slot and without a ceiling a
 * screenshot of a phone screen fills the thread end to end. Clamping keeps the
 * bubble a bubble; tapping still opens the real thing at full size.
 */
const MIN_RATIO = 0.62;
const MAX_RATIO = 1.9;

export function AttachmentBubble({
  conversationId,
  messageId,
  attachment,
  mine,
}: {
  conversationId: string;
  messageId: string;
  attachment: ChatAttachment;
  mine: boolean;
}) {
  const [wanted, setWanted] = useState(false);
  /**
   * The image's own proportions, learned when it loads.
   *
   * Cropping to a fixed box was the wrong default here: these are photographs of
   * a damaged carton or a locked gate, and the evidence is as likely to be at
   * the edge of the frame as the middle. 4:3 is only the placeholder height
   * while the real one is unknown.
   */
  const [ratio, setRatio] = useState(4 / 3);

  const links = useAttachmentLinks(conversationId, messageId, attachment.isImage || wanted);

  if (attachment.isImage) {
    return (
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Photo, ${formatBytes(attachment.bytes)}. Tap to open full size.`}
        onPress={() => {
          if (links.data?.downloadUrl) void Linking.openURL(links.data.downloadUrl);
        }}
        style={[styles.image, { aspectRatio: ratio }]}
      >
        {links.data?.previewUrl ? (
          <Image
            source={{ uri: links.data.previewUrl }}
            style={styles.imageFill}
            // `contain` would letterbox; with the container already matching the
            // image's own ratio, `cover` fills it edge to edge and crops nothing.
            resizeMode="cover"
            onLoad={(e) => {
              const { width, height } = e.nativeEvent.source;
              if (!width || !height) return;
              setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height)));
            }}
          />
        ) : (
          <View style={styles.imageFill}>
            {links.isError ? (
              <View style={styles.centre}>
                <Icon name="image" size={18} color={color.faint} />
                <Tiny style={styles.placeholderText}>Could not load</Tiny>
              </View>
            ) : (
              <View style={styles.centre}>
                <ActivityIndicator size="small" color={color.muted} />
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  }

  const opening = wanted && links.isFetching;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${attachment.name}, ${formatBytes(attachment.bytes)}. Tap to open.`}
      onPress={() => {
        // Second tap, once the link has arrived. The first only asks for it.
        if (links.data?.downloadUrl) void Linking.openURL(links.data.downloadUrl);
        else setWanted(true);
      }}
      style={({ pressed }) => [styles.file, pressed ? { opacity: 0.7 } : null]}
    >
      {opening ? (
        <ActivityIndicator size="small" color={mine ? color.onPrimary : color.muted} />
      ) : (
        <Icon name="paperclip" size={15} color={mine ? color.onPrimary : color.muted} />
      )}

      <View style={styles.fileText}>
        <Small
          style={[styles.fileName, mine ? styles.textMine : null]}
          numberOfLines={1}
        >
          {attachment.name}
        </Small>
        <Tiny style={[styles.fileSize, mine ? styles.textMineDim : null]}>
          {links.isError ? 'Could not open' : formatBytes(attachment.bytes)}
        </Tiny>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: {
    // Fills whatever the bubble allows rather than dictating it, so the 82% cap
    // on a narrow phone shrinks the photo instead of letting it overflow.
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceSoft,
    /*
     * A hairline, not a frame. Without it a photo of a white parcel or a bright
     * loading bay bleeds into the canvas and loses its edge; at this weight it
     * defines the shape without reading as a border.
     */
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.14)',
  },
  imageFill: { width: '100%', height: '100%' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  placeholderText: { fontSize: 10.5, color: color.faint },

  /*
   * No border, no tile, no panel. A file is a line of text with a clip beside
   * it — inside a bubble that is already a container, a second box around it is
   * just more edges to read.
   */
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 2,
    minWidth: 150,
  },
  fileText: { flex: 1, minWidth: 0 },
  fileName: { fontFamily: font.medium, color: color.ink },
  fileSize: { fontSize: 10.5, color: color.faint },
  textMine: { color: color.onPrimary },
  textMineDim: { color: color.onPrimary, opacity: 0.75 },
});
