import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { asUploadFile, type UploadFile } from '@/features/pod/capture';

/**
 * Getting a profile picture off the phone.
 *
 * Separate from `features/pod/capture` deliberately, even though both reach for
 * the same picker. The two want opposite things: proof must be left exactly as
 * shot, uncropped, because it is evidence of what was actually there — a profile
 * photo wants cropping to a square, since every surface renders it in one. And
 * the permission dialog has to say what the access is *for*; a driver asked for
 * the camera "to record proof for this stop" while editing their profile would
 * rightly wonder what the app was doing.
 */

/**
 * Square, and smaller than proof images.
 *
 * `allowsEditing` is what puts the crop box in front of the driver, and
 * `aspect` locks it to 1:1 so the framing they choose is the framing they get —
 * without it, a centre-crop at render time silently cuts off heads in landscape
 * shots. iOS honours `aspect` only when editing is on, which is why they travel
 * together.
 *
 * Quality 0.7 at a few hundred pixels on screen is far more than enough, and the
 * server caps the upload at 5 MB — a raw 12MP shot would be refused.
 */
const PROFILE_IMAGE_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.7,
  exif: false,
  allowsEditing: true,
  aspect: [1, 1],
};

function refused(what: string) {
  void showDialog({
    title: `${what} is switched off`,
    tone: 'warn',
    icon: 'lock',
    message: `Innovo Xpress needs ${what.toLowerCase()} access to set your profile picture.`,
    actions: [
      { label: 'Open settings', style: 'primary', onPress: () => void Linking.openSettings() },
      { label: 'Not now', style: 'cancel' },
    ],
  });
}

/** Take a new profile picture. Null if the driver backed out or said no. */
export async function takeProfilePhoto(): Promise<UploadFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    refused('The camera');
    return null;
  }

  const result = await ImagePicker.launchCameraAsync(PROFILE_IMAGE_OPTIONS);
  if (result.canceled || !result.assets[0]) return null;

  return asUploadFile(result.assets[0], 'profile-photo');
}

/** Choose one from the phone's library instead. */
export async function pickProfilePhoto(): Promise<UploadFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    refused('Photo library access');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync(PROFILE_IMAGE_OPTIONS);
  if (result.canceled || !result.assets[0]) return null;

  return asUploadFile(result.assets[0], 'profile-photo');
}
