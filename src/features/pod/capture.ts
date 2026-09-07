import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';

import { showDialog } from '@/components/Dialog';

/**
 * Turning what the driver captures into what the POD endpoint accepts.
 *
 * Two constraints from the server shape everything here:
 *  - photo AND signature are both mandatory, and the bytes are sniffed rather
 *    than trusted, so anything sent must be a real JPEG/PNG/WebP; and
 *  - the photo is capped at POD_MAX_PHOTO_BYTES (10 MB by default), which a
 *    modern phone camera clears in one shot — hence the compression below.
 */

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * A stable key for one capture attempt.
 *
 * Generated when the screen opens, NOT when Save is pressed: the point is that a
 * retry after a lost response replays the same key and gets the stored proof
 * back with a 200, instead of "already captured" with a 409. A key minted per
 * press would defeat that entirely.
 */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

/**
 * ~0.6 quality at 1600px is the sweet spot for this job: legible enough to read
 * a label or a damaged carton in evidence, small enough to upload from a van on
 * a bad connection.
 */
const IMAGE_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.6,
  exif: false,
  allowsEditing: false,
};

function asUploadFile(asset: ImagePicker.ImagePickerAsset, fallbackName: string): UploadFile {
  // The picker reports the mime type on most devices; when it does not, the
  // extension is a better guess than a hardcoded jpeg, and the server sniffs
  // the bytes regardless.
  const ext = asset.uri.split('.').pop()?.toLowerCase();
  const type =
    asset.mimeType ??
    (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');

  return {
    uri: asset.uri,
    name: asset.fileName ?? `${fallbackName}.${ext ?? 'jpg'}`,
    type,
  };
}

function refused(what: string) {
  void showDialog({
    title: `${what} is switched off`,
    tone: 'warn',
    icon: 'lock',
    message: `Innovo Xpress needs ${what.toLowerCase()} access to record proof for this stop.`,
    actions: [
      { label: 'Open settings', style: 'primary', onPress: () => void Linking.openSettings() },
      { label: 'Not now', style: 'cancel' },
    ],
  });
}

/** Take the proof photo. Returns null if the driver backed out. */
export async function takePhoto(): Promise<UploadFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    refused('The camera');
    return null;
  }

  const result = await ImagePicker.launchCameraAsync(IMAGE_OPTIONS);
  if (result.canceled || !result.assets[0]) return null;

  return asUploadFile(result.assets[0], 'proof-photo');
}

/**
 * Pick an existing photo instead of taking one.
 *
 * Kept because the useful case is real: the driver photographed the damage while
 * the app was closed, or the camera failed and they used the system one.
 */
export async function pickPhoto(): Promise<UploadFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    refused('Photo library access');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync(IMAGE_OPTIONS);
  if (result.canceled || !result.assets[0]) return null;

  return asUploadFile(result.assets[0], 'proof-photo');
}

/**
 * Write the signature pad's data URL out as a real PNG on disk.
 *
 * It has to become a file: React Native's FormData uploads by URI, and the
 * server reads magic bytes off the uploaded body — a base64 string in a text
 * field would be rejected as "not a JPEG, PNG or WebP image", correctly.
 */
export function signatureToFile(dataUrl: string): UploadFile {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  if (!base64) throw new Error('The signature came back empty. Please sign again.');

  // The browser preview has no writable filesystem, and a data URL is already a
  // valid source for both <Image> and FormData there — so skip the file entirely.
  if (Platform.OS === 'web') {
    return { uri: dataUrl, name: 'signature.png', type: 'image/png' };
  }

  // Cache, not documents: once uploaded this file is disposable, and the OS is
  // welcome to reclaim it.
  const file = new File(Paths.cache, `signature-${Crypto.randomUUID()}.png`);
  file.create({ overwrite: true });
  file.write(base64, { encoding: 'base64' });

  return { uri: file.uri, name: 'signature.png', type: 'image/png' };
}

/** Best-effort cleanup of a signature we are not going to send after all. */
export function discardFile(uri: string | undefined): void {
  if (Platform.OS === 'web') return;
  if (!uri || !uri.startsWith('file://')) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A stale cache file is harmless; the OS clears the cache directory itself.
  }
}

