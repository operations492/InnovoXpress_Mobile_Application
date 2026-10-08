import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { initials } from '@/lib/format';
import { color, font } from '@/theme/tokens';
import { Body } from './Text';

/**
 * Somebody's face, or their initials when there is no photo.
 *
 * The initials are not a placeholder waiting to be replaced — they are the
 * steady state for most people, since uploading a photo is optional and always
 * will be. So they get the same square, the same radius and the same weight as
 * the image; swapping one for the other changes what is in the box and nothing
 * about the box.
 *
 * Sized by one `size` prop rather than a style override because every dimension
 * here has to move together — a radius or font size left behind at the old scale
 * is the usual way an avatar ends up subtly wrong at one call site.
 */
export function Avatar({
  uri,
  name,
  size = 58,
}: {
  /** A signed URL from the API. Short-lived, so never cached beyond the query. */
  uri?: string | null;
  name?: string | null;
  size?: number;
}) {
  /*
   * A signed URL expires, and an expired one fails to load rather than loading
   * something wrong. Falling back to initials on error means a stale URL degrades
   * to the normal no-photo state instead of a broken-image box.
   *
   * Which URL failed, rather than a boolean "it failed". That is what lets a new
   * photo — or a freshly signed link to the same one — be tried again without an
   * effect to reset the flag: a different `uri` simply is not the one that
   * failed. A boolean would need clearing when the prop changed, and clearing
   * state from an effect is a cascading render.
   */
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = uri != null && failedUri === uri;

  const box = {
    width: size,
    height: size,
    // Half the side — a true circle at any size. Must be derived from `size`
    // rather than fixed, or the shape drifts the moment an avatar is rendered at
    // a different scale.
    borderRadius: size / 2,
  };

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, box]}
        onError={() => setFailedUri(uri)}
        accessibilityIgnoresInvertColors
        accessibilityRole="image"
        accessibilityLabel={name ? `${name}'s profile photo` : 'Profile photo'}
      />
    );
  }

  return (
    <View style={[styles.fallback, box]}>
      <Body style={[styles.text, { fontSize: Math.round(size * 0.345) }]}>
        {name ? initials(name) : '··'}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  // A tint behind the image so a photo with transparency, or one still loading,
  // sits on the same colour the initials would have used.
  image: { backgroundColor: color.primary },

  fallback: { backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: font.display, color: color.onPrimary },
});
