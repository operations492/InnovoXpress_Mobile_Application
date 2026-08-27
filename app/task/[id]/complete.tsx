import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import type { PodLeg } from '@/api/types';
import { ActionTile, PrimaryButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SignaturePad } from '@/components/SignaturePad';
import { ErrorState, LoadingState, messageFor } from '@/components/States';
import { Body, Mono, Small, Tiny } from '@/components/Text';
import {
  discardFile,
  newIdempotencyKey,
  pickPhoto,
  signatureToFile,
  takePhoto,
  type UploadFile,
} from '@/features/pod/capture';
import { useCaptureProof, useProofs, useTask } from '@/features/tasks/queries';
import { formatBytes, formatStamp } from '@/lib/format';
import { color, font, radius } from '@/theme/tokens';

/**
 * Proof of delivery — the Complete Task mockup.
 *
 * This screen is the only way a job ever reaches PICKED_UP or DELIVERED: the
 * status endpoint rejects both words by schema, and the server writes the proof
 * and the status change in one transaction so the two can never disagree.
 *
 * Which means the Save button is not a form submit. It is the moment the job
 * moves, and everything above it exists to make sure that moment is right.
 */
export default function CompleteTaskScreen() {
  const { id, leg: legParam, view } = useLocalSearchParams<{
    id: string;
    leg?: string;
    view?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const leg: PodLeg = legParam === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
  const readOnly = view === '1';

  const { data: task, isLoading, isError, error, refetch } = useTask(id);
  const capture = useCaptureProof(id ?? '');

  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [signature, setSignature] = useState<UploadFile | null>(null);
  /*
   * null means "the driver has not typed anything yet", which is what lets the
   * order's own contact seed the field WITHOUT an effect that writes state back
   * during render. Seeding via useEffect made this a two-pass render and, once
   * the task arrived late, could overwrite something already typed.
   */
  const [typedReceivedBy, setTypedReceivedBy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [padOpen, setPadOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Minted once per visit, not per press. A tap that times out and is tapped
   * again replays the same key, and the server answers 200 with the stored proof
   * instead of "already captured" with a 409.
   */
  const [idempotencyKey] = useState(newIdempotencyKey);

  const party = leg === 'PICKUP' ? task?.sender : task?.receiver;

  // Pre-filled with whoever the order says is at this end, and replaced the
  // moment the driver types — which is the case worth recording. Derived rather
  // than stored, so the seed appears as soon as the task loads without a second
  // render, and can never clobber what has already been typed.
  const receivedBy = typedReceivedBy ?? party?.name ?? '';

    // Drop the signature PNG from the cache if the driver leaves without sending.
  useEffect(
    () => () => {
      if (signature) discardFile(signature.uri);
    },
    [signature],
  );

  /*
   * The signer's name is now part of the evidence, so it gates the save like the
   * two files do. Trimmed before testing: a space is not a name, and the server
   * trims it anyway — better to fail here than after the upload.
   */
  const signedByName = receivedBy.trim();
  const ready = Boolean(photo && signature && signedByName);

  const onSignature = useCallback(
    (dataUrl: string) => {
      try {
        const file = signatureToFile(dataUrl);
        setSignature((previous) => {
          if (previous) discardFile(previous.uri);
          return file;
        });
        setPadOpen(false);
      } catch (e) {
        Alert.alert('Signature not saved', e instanceof Error ? e.message : 'Please try again.');
      }
    },
    [],
  );

  const save = useCallback(async () => {
    if (!ready || !task || !photo || !signature || busy) return;

    setBusy(true);
    try {
      await capture.mutateAsync({
        leg,
        photo,
        signature,
        signedByName,
        note: note.trim() || undefined,
        idempotencyKey,
      });

      // The signature file has served its purpose the moment the server has it.
      discardFile(signature.uri);
      setSignature(null);

      router.replace(`/task/${task.id}`);
    } catch (e) {
      const conflict = e instanceof ApiError && e.isConflict;
      Alert.alert(
        conflict ? 'This stop is already closed' : 'Could not save the proof',
        messageFor(e),
        conflict
          ? [{ text: 'Back to job', onPress: () => router.replace(`/task/${task.id}`) }]
          : [{ text: 'OK' }],
      );
    } finally {
      setBusy(false);
    }
  }, [ready, task, photo, signature, busy, capture, leg, signedByName, note, idempotencyKey, router]);

  if (isLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ScreenHeader title="Complete Task" />
        <LoadingState />
      </View>
    );
  }

  if (isError || !task) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ScreenHeader title="Complete Task" />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  if (readOnly) {
    return <CapturedProof id={id} leg={leg} insetTop={insets.top} insetBottom={insets.bottom} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <ScreenHeader title="Complete Task" tag={leg === 'PICKUP' ? 'Pickup' : 'Delivery'} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.stop}>
          <Icon name={leg === 'PICKUP' ? 'home' : 'map-pin'} size={15} color={color.primary} />
          <Small style={styles.stopText} numberOfLines={2}>
            {party?.name} · {party?.line1}
          </Small>
        </View>

        <View style={styles.field}>
          <Tiny style={styles.label}>
            {leg === 'PICKUP' ? 'Handed over by' : 'Received by'}
          </Tiny>
          <TextInput
            value={receivedBy}
            onChangeText={setTypedReceivedBy}
            placeholder="Name of the person taking the goods"
            placeholderTextColor={color.faint}
            style={styles.input}
            editable={!busy}
          />
        </View>

        <View style={styles.field}>
          <Tiny style={styles.label}>Notes</Tiny>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything worth recording — condition, where it was left, who signed"
            placeholderTextColor={color.faint}
            multiline
            numberOfLines={3}
            maxLength={400}
            style={[styles.input, styles.textarea]}
            editable={!busy}
          />
          <Tiny style={styles.help}>
            Saved with the proof on the order, where dispatch can read it.
          </Tiny>
        </View>

        <View style={styles.captureRow}>
          <ActionTile
            label="Signature"
            icon="edit-2"
            done={Boolean(signature)}
            onPress={() => setPadOpen(true)}
          />
          <ActionTile
            label="Photo"
            icon="camera"
            done={Boolean(photo)}
            onPress={() => void takePhoto().then((f) => f && setPhoto(f))}
          />
          <ActionTile
            label="Upload"
            icon="image"
            onPress={() => void pickPhoto().then((f) => f && setPhoto(f))}
          />
        </View>

        {photo || signature ? (
          <View style={styles.previews}>
            {photo ? (
              <Preview
                title="Photo"
                uri={photo.uri}
                onClear={busy ? undefined : () => setPhoto(null)}
              />
            ) : null}
            {signature ? (
              <Preview
                title="Signature"
                uri={signature.uri}
                contain
                onClear={
                  busy
                    ? undefined
                    : () => {
                        discardFile(signature.uri);
                        setSignature(null);
                      }
                }
              />
            ) : null}
          </View>
        ) : null}

        <View style={styles.reqs}>
          <Requirement
            label="Signature from the recipient"
            done={Boolean(signature)}
            onPress={() => setPadOpen(true)}
          />
          <Requirement
            label="Photo as proof of this stop"
            done={Boolean(photo)}
            onPress={() => void takePhoto().then((f) => f && setPhoto(f))}
            last
          />
        </View>

        <Tiny style={styles.footnote}>
          Both are required — the server rejects a capture that is missing either, and checks the
          file contents rather than trusting the file name. Saving moves this job to{' '}
          {leg === 'PICKUP' ? 'Picked Up' : 'Delivered'}, and that cannot be undone from the app.
        </Tiny>
      </ScrollView>

      <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12 }]}>
        <PrimaryButton
          label={
            busy
              ? 'Sending proof…'
              : leg === 'PICKUP'
                ? 'Complete Pickup'
                : 'Complete Delivery'
          }
          icon="check"
          disabled={!ready}
          loading={busy}
          onPress={() => void save()}
        />
        {!ready ? (
          <Tiny style={styles.saveHint}>
            {!signedByName
              ? leg === 'PICKUP'
                ? 'Enter who handed the parcel over.'
                : 'Enter who received the parcel.'
              : !signature && !photo
                ? 'Capture a signature and a photo to finish this stop.'
                : !signature
                  ? 'A signature is still needed.'
                  : 'A photo is still needed.'}
          </Tiny>
        ) : null}
      </View>

      <SignaturePad
        visible={padOpen}
        signerName={receivedBy || party?.name}
        onCancel={() => setPadOpen(false)}
        onCapture={onSignature}
      />
    </KeyboardAvoidingView>
  );
}

function Preview({
  title,
  uri,
  contain = false,
  onClear,
}: {
  title: string;
  uri: string;
  contain?: boolean;
  onClear?: () => void;
}) {
  return (
    <View style={styles.preview}>
      <Image
        source={{ uri }}
        style={styles.previewImage}
        resizeMode={contain ? 'contain' : 'cover'}
        accessibilityLabel={`${title} preview`}
      />
      <View style={styles.previewBar}>
        <Tiny style={styles.previewTitle}>{title}</Tiny>
        {onClear ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${title}`} onPress={onClear} hitSlop={8}>
            <Icon name="x" size={14} color={color.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Requirement({
  label,
  done,
  onPress,
  last = false,
}: {
  label: string;
  done: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ checked: done }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.req,
        last ? styles.reqLast : null,
        pressed ? { backgroundColor: color.surfaceSoft } : null,
      ]}
    >
      <View style={[styles.reqIcon, done ? styles.reqIconDone : null]}>
        <Icon
          name={done ? 'check' : 'alert-circle'}
          size={15}
          color={done ? color.success : color.danger}
        />
      </View>
      <Body style={[styles.reqLabel, done ? styles.reqLabelDone : null]}>{label}</Body>
      <Icon name="chevron-right" size={18} color={color.faint} />
    </Pressable>
  );
}

/**
 * Read-only view of proof already captured.
 *
 * The URLs are signed and short-lived (POD_SIGNED_URL_TTL, 300s by default)
 * because the `pod` bucket is private and object paths are guessable — so this
 * refetches rather than caching what it was given last time.
 */
function CapturedProof({
  id,
  leg,
  insetTop,
  insetBottom,
}: {
  id: string;
  leg: PodLeg;
  insetTop: number;
  insetBottom: number;
}) {
  const { data, isLoading, isError, error, refetch } = useProofs(id);
  const proof = useMemo(() => data?.find((p) => p.leg === leg), [data, leg]);

  return (
    <View style={[styles.screen, { paddingTop: insetTop }]}>
      <ScreenHeader title="Captured proof" tag={leg === 'PICKUP' ? 'Pickup' : 'Delivery'} />

      {isLoading ? (
        <LoadingState label="Fetching proof…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !proof ? (
        <ErrorState
          error={new Error('No proof has been captured for this stop yet.')}
          onRetry={() => void refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insetBottom + 24 }]}>
          <View style={styles.stop}>
            <Icon name="check-circle" size={15} color={color.success} />
            <Small style={styles.stopText}>
              Captured {formatStamp(proof.capturedAt)}
              {proof.capturedByDriver?.name ? ` by ${proof.capturedByDriver.name}` : ''}
            </Small>
          </View>

          {proof.photo.url ? (
            <View style={styles.proofBlock}>
              <Tiny style={styles.label}>Photo</Tiny>
              <Image source={{ uri: proof.photo.url }} style={styles.proofImage} resizeMode="cover" />
              <Mono style={styles.proofMeta}>
                {proof.photo.mime} · {formatBytes(proof.photo.bytes)}
              </Mono>
            </View>
          ) : null}

          {proof.signature.url ? (
            <View style={styles.proofBlock}>
              <Tiny style={styles.label}>Signature</Tiny>
              <Image
                source={{ uri: proof.signature.url }}
                style={[styles.proofImage, styles.proofSignature]}
                resizeMode="contain"
              />
              <Mono style={styles.proofMeta}>
                {proof.signature.mime} · {formatBytes(proof.signature.bytes)}
              </Mono>
            </View>
          ) : null}

          <Tiny style={styles.footnote}>
            These links are signed and expire after about {Math.round(proof.expiresInSeconds / 60)}{' '}
            minutes. Pull back into this screen to load them again. Replacing a proof is an
            admin-only action in the console — the record here stays as it was captured.
          </Tiny>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  scroll: { paddingBottom: 28 },

  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: color.primarySoft,
  },
  stopText: { flex: 1, color: color.body, fontSize: 12.5, lineHeight: 17 },

  field: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
    gap: 7,
  },
  label: { fontFamily: font.bold, fontSize: 11.5, color: color.primary },
  input: {
    fontFamily: font.regular,
    fontSize: 15.5,
    color: color.ink,
    backgroundColor: color.surfaceSoft,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  textarea: { minHeight: 76, textAlignVertical: 'top' },
  help: { fontSize: 11, color: color.muted },

  captureRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 16 },

  previews: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 12 },
  preview: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  previewImage: { width: '100%', height: 110, backgroundColor: color.surfaceSoft },
  previewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  previewTitle: { fontFamily: font.bold, fontSize: 11, color: color.body },

  reqs: {
    marginTop: 16,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.line2,
  },
  req: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
  },
  reqLast: { borderBottomWidth: 0 },
  reqIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqIconDone: { backgroundColor: color.successSoft },
  reqLabel: { flex: 1, fontSize: 15, color: color.ink, fontFamily: font.medium },
  reqLabelDone: { color: color.muted },

  footnote: {
    paddingHorizontal: 20,
    paddingTop: 16,
    lineHeight: 17,
    color: color.muted,
  },

  saveBar: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 8,
  },
  saveHint: { textAlign: 'center', color: color.muted },

  proofBlock: { paddingHorizontal: 18, paddingTop: 18, gap: 8 },
  proofImage: {
    width: '100%',
    height: 240,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSoft,
  },
  proofSignature: { height: 160, backgroundColor: color.surface },
  proofMeta: { fontFamily: font.mono, fontSize: 11.5, color: color.muted },
});
