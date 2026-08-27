import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from './Button';
import { Icon } from './Icon';
import { Display, Small } from './Text';
import { color, font } from '@/theme/tokens';

/**
 * Web signature pad.
 *
 * The native pad runs on `react-native-signature-canvas`, which draws inside a
 * WebView — and WebView has no web build, so it cannot bundle for the browser.
 * Rather than disable the step and leave a hole in the flow being reviewed, this
 * draws on a plain `<canvas>`: a DOM element is available here by definition,
 * and it produces the same `data:image/png;base64,…` the caller expects.
 *
 * Metro picks this file automatically on web; the native pad is untouched.
 */
interface Props {
  visible: boolean;
  signerName?: string | null;
  onCancel: () => void;
  onCapture: (dataUrl: string) => void;
}

export function SignaturePad({ visible, signerName, onCancel, onCapture }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  /**
   * Size the backing store to the CSS box times devicePixelRatio, or the stroke
   * is soft on a retina screen and the exported PNG is half resolution.
   */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // White, not transparent: the server accepts PNG and a transparent
    // signature is unreadable against a dark background in the console.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = color.ink;
  }, []);

  useEffect(() => {
    if (!visible) return;
    // One frame's delay so the modal has laid the canvas out before measuring.
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [visible, fit]);

  const pointFrom = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const begin = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    setHasInk(true);
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const reset = () => {
    fit();
    setHasInk(false);
  };

  const close = () => {
    reset();
    onCancel();
  };

  const confirm = () => {
    const dataUrl = canvasRef.current?.toDataURL('image/png');
    if (!dataUrl) return;
    onCapture(dataUrl);
    reset();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={close}>
      <View style={styles.screen}>
        <View style={styles.head}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel signature"
            onPress={close}
            style={styles.close}
          >
            <Icon name="x" size={22} color={color.ink} />
          </Pressable>
          <View style={styles.headText}>
            <Display style={styles.title}>Signature</Display>
            <Small>{signerName ? `Ask ${signerName} to sign below` : 'Sign in the box below'}</Small>
          </View>
        </View>

        <View style={styles.canvasWrap}>
          <canvas
            ref={canvasRef}
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' }}
          />
          {!hasInk ? (
            <View pointerEvents="none" style={styles.hint}>
              <View style={styles.hintLine} />
              <Small style={styles.hintText}>Draw your signature with the mouse</Small>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          <SecondaryButton label="Clear" icon="rotate-ccw" onPress={reset} style={styles.clear} />
          <PrimaryButton
            label="Use this signature"
            icon="check"
            disabled={!hasInk}
            onPress={confirm}
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

  canvasWrap: { flex: 1, backgroundColor: color.surface },
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
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  clear: { flex: 1 },
  confirm: { flex: 2 },
});
