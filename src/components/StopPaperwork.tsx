import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import type { OrderDocument, PodLeg } from '@/api/types';
import { mustSignHere, signedHere } from '@/features/pod/documents';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { Body, SectionLabel, Small, Tiny } from './Text';

/**
 * The paperwork a driver has to deal with at this stop.
 *
 * Shows only what belongs here — the server filters by leg, so a document meant
 * for the dropoff is simply absent at the pickup rather than greyed out. Nothing
 * on this card is optional reading: every row is either something to show the
 * customer or something to get signed before the stop can close.
 */
/** Which row is mid-action, and which of its two buttons was pressed. */
export interface DocBusy {
  kind: string;
  action: 'open' | 'sign';
}

export function StopPaperwork({
  documents,
  leg,
  queuedKinds,
  busy,
  busyDoc,
  onOpen,
  onSign,
}: {
  documents: OrderDocument[];
  leg: PodLeg;
  /** Signatures captured here but still on the device. */
  queuedKinds: Set<string>;
  busy: boolean;
  /**
   * Both of these take a round trip — opening re-signs the link first, signing
   * uploads — and neither is instant on a van's connection. Without a visible
   * busy state the driver taps again, which at best wastes an upload and at
   * worst sends the same signature twice.
   */
  busyDoc: DocBusy | null;
  onOpen: (doc: OrderDocument) => void;
  onSign: (doc: OrderDocument) => void;
}) {
  if (documents.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionLabel style={styles.heading}>Paperwork for this stop</SectionLabel>

      {documents.map((doc) => {
        const required = mustSignHere(doc, leg);
        const queued = queuedKinds.has(doc.kind);
        const done = signedHere(doc, leg) || queued;
        const rowBusy = busyDoc?.kind === doc.kind ? busyDoc : null;

        return (
          <View key={doc.kind} style={styles.row}>
            <View style={[styles.state, done ? styles.stateDone : required ? styles.stateTodo : null]}>
              <Icon
                name={done ? 'check' : required ? 'edit-3' : 'file-text'}
                size={14}
                color={done || required ? color.onPrimary : color.muted}
              />
            </View>

            <View style={styles.body}>
              <Body style={styles.label} numberOfLines={1}>
                {doc.label}
              </Body>

              <Tiny style={styles.status}>
                {done
                  ? queued
                    ? 'Signed — will send when you have signal'
                    : 'Signed at this stop'
                  : required
                    ? 'Must be signed here before you can finish'
                    : 'Show to the customer'}
              </Tiny>

              <View style={styles.actions}>
                {/*
                  Opening re-fetches rather than using a held link: the url in
                  this list is signed and stops working after a few minutes, so
                  a driver who opened the screen at the previous stop would tap
                  a dead link here.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open the ${doc.label}`}
                  accessibilityState={{ busy: rowBusy?.action === 'open' }}
                  onPress={() => onOpen(doc)}
                  // Any action on this row locks both of its buttons: opening
                  // re-signs the link the signature flow would use.
                  disabled={busy || rowBusy !== null}
                  style={({ pressed }) => [
                    styles.action,
                    pressed ? styles.pressed : null,
                    rowBusy ? styles.disabled : null,
                  ]}
                >
                  {rowBusy?.action === 'open' ? (
                    <ActivityIndicator size="small" color={color.primary} />
                  ) : (
                    <Icon name="external-link" size={13} color={color.primary} />
                  )}
                  <Tiny style={styles.actionText}>
                    {rowBusy?.action === 'open' ? 'Opening…' : 'Open'}
                  </Tiny>
                </Pressable>

                {required && !done ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Get the ${doc.label} signed`}
                    accessibilityState={{ busy: rowBusy?.action === 'sign' }}
                    onPress={() => onSign(doc)}
                    disabled={busy || rowBusy !== null}
                    style={({ pressed }) => [
                      styles.action,
                      styles.actionPrimary,
                      pressed ? styles.pressed : null,
                      rowBusy ? styles.disabled : null,
                    ]}
                  >
                    {rowBusy?.action === 'sign' ? (
                      <ActivityIndicator size="small" color={color.onPrimary} />
                    ) : (
                      <Icon name="edit-3" size={13} color={color.onPrimary} />
                    )}
                    <Tiny style={styles.actionPrimaryText}>
                      {rowBusy?.action === 'sign' ? 'Sending…' : 'Get signature'}
                    </Tiny>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}

      {/*
        Said once, plainly, and only when it is true.

        The operator was warned there is no way around this when they ticked the
        box; the driver finds out here. Better up front than as a refusal after
        they have photographed everything.
      */}
      {documents.some((d) => mustSignHere(d, leg)) ? (
        <Small style={styles.warn}>
          This stop cannot be completed until the paperwork above is signed.
        </Small>
      ) : null}
    </View>
  );
}

/**
 * Show a document without leaving the app.
 *
 * These are PDFs on a signed Supabase link, and that rules out the obvious
 * options. `Linking.openURL` hands the file to whatever reader the phone has,
 * which drops the driver out of the app mid-stop with a customer waiting. A
 * WebView is worse than it looks: iOS renders PDFs in `WKWebView`, Android does
 * not render them at all — it shows a blank page or starts a download — and
 * Android is what the drivers carry.
 *
 * `openBrowserAsync` is a Chrome Custom Tab on Android and
 * `SFSafariViewController` on iOS. Both render PDFs, both sit on top of this
 * app with a Done button that comes straight back to the stop, and the signed
 * link never reaches a third party the way a Google-viewer URL would.
 *
 * Falls back to the old behaviour when the native module is missing — which is
 * every build made before this was added, including whatever is on the test
 * phone right now. Opening the document externally beats not opening it.
 */
export async function openDocumentUrl(url: string | null): Promise<boolean> {
  if (!url) return false;

  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      enableBarCollapsing: false,
    });
    return true;
  } catch {
    // Older binary, or a platform with no custom tab. Hand it to the OS.
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 18, gap: 9 },
  heading: { marginBottom: 1 },

  row: {
    flexDirection: 'row',
    gap: 11,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },

  state: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bgCanvas,
    borderWidth: 1,
    borderColor: color.line,
  },
  stateTodo: { backgroundColor: color.warn, borderColor: color.warn },
  stateDone: { backgroundColor: color.success, borderColor: color.success },

  body: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontFamily: font.semibold },
  status: { fontSize: 11.5, color: color.muted, lineHeight: 16 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 7, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  actionText: { color: color.primary, fontFamily: font.semibold, fontSize: 12 },
  actionPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  actionPrimaryText: { color: color.onPrimary, fontFamily: font.semibold, fontSize: 12 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.6 },

  warn: { color: color.warn, fontSize: 12, lineHeight: 17, paddingTop: 2 },
});
