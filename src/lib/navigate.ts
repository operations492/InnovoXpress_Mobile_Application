import { Linking, Platform, Share } from 'react-native';

import { showDialog } from '@/components/Dialog';

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

/**
 * Where to navigate FROM is deliberately never specified.
 *
 * Every URL below omits an origin (`saddr` on Apple, `origin` on Google), and
 * that is what makes the map app start from the driver's current position. It
 * would be easy to pass our own last known fix instead — and worse: that fix can
 * be a minute old and a mile back, so the route would be drawn from where the
 * driver WAS. The navigation app has a live GPS feed of its own; letting it use
 * that is both simpler and more accurate than anything this app can supply.
 *
 * Candidates are returned best-first and tried in order, because a driver's
 * phone may have any of them and none is guaranteed.
 */
function urls(d: Destination): string[] {
  const list: string[] = [];
  const web = (q: string) =>
    `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;

  if (hasCoords(d)) {
    const q = `${d.lat},${d.lng}`;

    if (Platform.OS === 'ios') {
      // maps:// opens Apple Maps directly and skips the "open in?" sheet.
      // dirflg=d is driving; with no saddr it routes from the current location.
      list.push(`maps://?daddr=${q}&dirflg=d`);
    } else {
      /*
       * Turn-by-turn, started immediately from where the driver is standing.
       *
       * This replaced a `geo:` URL, which only DROPPED A PIN on the map — the
       * driver still had to find and press Directions, at the wheel, every
       * single stop. `google.navigation:` begins guidance outright.
       */
      list.push(`google.navigation:q=${q}&mode=d`);
      // Keeps a driver who prefers another navigation app on that app.
      list.push(`geo:${q}?q=${q}(${encodeURIComponent(d.label ?? 'Destination')})`);
    }

    list.push(web(q));
    return list;
  }

  if (d.address) {
    const q = encodeURIComponent(d.address);
    list.push(
      Platform.OS === 'ios' ? `maps://?daddr=${q}&dirflg=d` : `google.navigation:q=${q}&mode=d`,
    );
    list.push(web(q));
    return list;
  }

  return [];
}

export async function openNavigation(d: Destination): Promise<void> {
  const candidates = urls(d);

  if (candidates.length === 0) {
    void showDialog({
      title: 'No location',
      tone: 'warn',
      message: 'This stop has no coordinates or address to navigate to.',
    });
    return;
  }

  /*
   * Tried in order rather than probed with `canOpenURL`.
   *
   * On Android 11+ `canOpenURL` answers false for any scheme not declared in a
   * `<queries>` block in the manifest, even when an app that handles it is
   * installed — so probing would skip a working navigation app and drop the
   * driver into the browser. Attempting the intent tells the truth.
   *
   * The last candidate is always an https maps link, which any phone with a
   * browser can open, so this only reaches the dialog on a device with neither
   * a maps app nor a browser.
   */
  for (const candidate of candidates) {
    try {
      await Linking.openURL(candidate);
      return;
    } catch {
      // Nothing handles this scheme; fall through to the next.
    }
  }

  void showDialog({
    title: 'Cannot open maps',
    tone: 'danger',
    message: 'No map application or browser is available on this device.',
  });
}

/**
 * Dial or text the contact for the stop the driver is working.
 *
 * These used to swallow every failure with `.catch(() => undefined)`, which made
 * a broken handoff indistinguishable from a slow one: the driver taps Call,
 * nothing happens, and there is nothing on screen to say why. On a phone with no
 * dialler bound to `tel:` — a data-only tablet, a stripped ROM — that is a
 * silent dead end in the middle of a delivery.
 *
 * `who` is the party's name so the message can say which number failed, since
 * the same button dials the sender at pickup and the receiver at delivery.
 */
function dial(scheme: 'tel' | 'sms', phone: string, who: string | undefined) {
  const label = scheme === 'tel' ? 'call' : 'message';
  void Linking.openURL(`${scheme}:${phone.replace(/\s+/g, '')}`).catch(() => {
    void showDialog({
      title: `Cannot ${label} from this phone`,
      tone: 'danger',
      message:
        `Nothing on this device is set up to ${label} ${who ?? 'this contact'}.\n\n` +
        `The number is ${phone} — dial it by hand if you need to.`,
    });
  });
}

export function callNumber(phone: string | null | undefined, who?: string): void {
  if (!phone) return;
  dial('tel', phone, who);
}

export function textNumber(phone: string | null | undefined, who?: string): void {
  if (!phone) return;
  dial('sms', phone, who);
}

/**
 * Hand an address to whatever mail app the phone has.
 *
 * Reports failure for the same reason `dial` does: a driver who taps this and
 * sees nothing cannot tell a missing mail app from a slow one. Shows the address
 * so it can be written down or read out either way.
 */
export function sendEmail(email: string | null | undefined, subject?: string): void {
  if (!email) return;
  const q = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  void Linking.openURL(`mailto:${email}${q}`).catch(() => {
    void showDialog({
      title: 'Cannot send email from this phone',
      tone: 'danger',
      message: `No mail app is set up on this device.\n\nThe address is ${email}.`,
    });
  });
}

/** Share a stop with someone — the mockup's share button on the pickup card. */
export async function shareStop(d: Destination): Promise<void> {
  const line = [d.label, d.address].filter(Boolean).join(' — ');
  const link = hasCoords(d)
    ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`
    : null;

  await Share.share({ message: [line, link].filter(Boolean).join('\n') }).catch(() => undefined);
}
