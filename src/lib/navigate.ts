import { Alert, Linking, Platform, Share } from 'react-native';

/**
 * Hand a destination to the phone's own map app.
 *
 * Coordinates win over the address string whenever the order has them: the
 * console pins both ends on a map when the order is created, so the pin is what
 * dispatch actually meant, while the typed address is what someone read over the
 * phone. Falling back to the string keeps older orders working.
 */
export interface Destination {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  label?: string | null;
}

function hasCoords(d: Destination): d is Destination & { lat: number; lng: number } {
  return typeof d.lat === 'number' && typeof d.lng === 'number';
}

function url(d: Destination): string | null {
  if (hasCoords(d)) {
    const q = `${d.lat},${d.lng}`;
    if (Platform.OS === 'ios') {
      // maps:// opens Apple Maps directly and skips the "open in?" sheet.
      return `maps://?daddr=${q}&dirflg=d`;
    }
    // The geo: intent lets the driver keep whichever navigation app they use.
    return `geo:${q}?q=${q}(${encodeURIComponent(d.label ?? 'Destination')})`;
  }

  if (d.address) {
    const q = encodeURIComponent(d.address);
    return Platform.OS === 'ios' ? `maps://?daddr=${q}&dirflg=d` : `geo:0,0?q=${q}`;
  }

  return null;
}

export async function openNavigation(d: Destination): Promise<void> {
  const primary = url(d);
  if (!primary) {
    Alert.alert('No location', 'This stop has no coordinates or address to navigate to.');
    return;
  }

  try {
    await Linking.openURL(primary);
  } catch {
    // No map app registered for the scheme — the browser always works.
    const q = hasCoords(d) ? `${d.lat},${d.lng}` : encodeURIComponent(d.address ?? '');
    await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`).catch(() =>
      Alert.alert('Cannot open maps', 'No map application is available on this device.'),
    );
  }
}

export function callNumber(phone: string | null | undefined): void {
  if (!phone) return;
  void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`).catch(() => undefined);
}

export function textNumber(phone: string | null | undefined): void {
  if (!phone) return;
  void Linking.openURL(`sms:${phone.replace(/\s+/g, '')}`).catch(() => undefined);
}

export function sendEmail(email: string | null | undefined, subject?: string): void {
  if (!email) return;
  const q = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  void Linking.openURL(`mailto:${email}${q}`).catch(() => undefined);
}

/** Share a stop with someone — the mockup's share button on the pickup card. */
export async function shareStop(d: Destination): Promise<void> {
  const line = [d.label, d.address].filter(Boolean).join(' — ');
  const link = hasCoords(d)
    ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`
    : null;

  await Share.share({ message: [line, link].filter(Boolean).join('\n') }).catch(() => undefined);
}
