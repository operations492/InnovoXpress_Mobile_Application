import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';

import { PrimaryButton, SecondaryButton } from './Button';
import { Icon } from './Icon';
import { Display, Small } from './Text';
import { color, font } from '@/theme/tokens';

/**
 * A full-screen signature pad.
 *
 * Full-screen rather than an inline box for a physical reason: this is signed
 * with a finger, usually by someone else, usually while the driver holds the
 * phone. A 120px strip produces a scrawl; the whole screen produces a signature.
 *
 * The pad renders in a WebView, so it draws on top of everything — hence a
 * Modal, which owns the whole surface and cannot be scrolled out from under the
 * finger mid-stroke.
 */
interface Props {
  visible: boolean;
  /** Who is signing — shown above the line so the driver can confirm before capturing. */
  signerName?: string | null;
  onCancel: () => void;
  /** Receives a `data:image/png;base64,…` URL. */
  onCapture: (dataUrl: string) => void;
}

/**
 * The canvas lives inside a WebView, so its chrome is styled with CSS rather
 * than with our tokens. The library's own buttons are hidden — ours sit outside
 * the WebView where they can be sized for a gloved thumb.
 */
const WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--body canvas { border-radius: 0; box-shadow: none; }
  .m-signature-pad--footer { display: none; }
  body, html { margin: 0; padding: 0; height: 100%; background: #FFFFFF; }
`;

export function SignaturePad({ visible, signerName, onCancel, onCapture }: Props) {
  const ref = useRef<SignatureViewRef>(null);
  const insets = useSafeAreaInsets();
  const [hasInk, setHasInk] = useState(false);

  const reset = () => {
    ref.current?.clearSignature();
    setHasInk(false);
  };

  const close = () => {
    reset();
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel signature"
            onPress={close}
            hitSlop={10}
            style={styles.close}
          >
            <Icon name="x" size={22} color={color.ink} />
          </Pressable>
          <View style={styles.headText}>
            <Display style={styles.title}>Signature</Display>
            <Small>{signerName ? `Ask ${signerName} to sign below` : 'Sign in the box below'}</Small>
          </View>
        </View>

        <View style={styles.canvas}>
          <SignatureScreen
            ref={ref}
            webStyle={WEB_STYLE}
            backgroundColor="#FFFFFF"
            penColor={color.ink}
            minWidth={1.6}
            maxWidth={3.4}
            // PNG so the stroke stays crisp; the server accepts PNG, JPEG and
            // WebP, and a signature is exactly the case JPEG blurs worst.
            imageType="image/png"
            // Trimming the empty margin means the stored proof is the signature,
            // not a mostly-white rectangle with a mark in one corner.
            trimWhitespace
            autoClear={false}
            androidHardwareAccelerationDisabled={false}
            onBegin={() => setHasInk(true)}
            onOK={(sig) => {
              if (!sig) return;
              onCapture(sig);
              reset();
            }}
            onEmpty={() => setHasInk(false)}
            onClear={() => setHasInk(false)}
            style={StyleSheet.absoluteFill}
          />

          {!hasInk ? (
            <View pointerEvents="none" style={styles.hint}>
              <View style={styles.hintLine} />
              <Small style={styles.hintText}>Sign here with your finger</Small>
            </View>
          ) : null}
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <SecondaryButton label="Clear" icon="rotate-ccw" onPress={reset} style={styles.clear} />
          <PrimaryButton
            label="Use this signature"
            icon="check"
            disabled={!hasInk}
            onPress={() => ref.current?.readSignature()}
            style={styles.confirm}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surface },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  title: { fontSize: 17 },

  canvas: { flex: 1, backgroundColor: color.surface },
  hint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 60,
    gap: 10,
  },
  hintLine: { width: '78%', height: 1.5, backgroundColor: color.line },
  hintText: { fontFamily: font.medium, color: color.faint },

  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  clear: { flex: 1 },
  confirm: { flex: 2 },
});
