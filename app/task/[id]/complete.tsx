import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { showDialog } from '@/components/Dialog';
import { DispatchContact } from '@/components/DispatchContact';
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
  /*
   * Held as text, not a number. A numeric state would have to represent "the
   * field is empty" as 0 or NaN, and both of those are counts the driver could
   * plausibly be part-way through typing.
   */
  const [countText, setCountText] = useState('');
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

  /*
   * The expected total IS shown, because the count must match to proceed.
   *
   * Those two decisions belong together. Hiding the number makes the count a
   * genuine count; hiding it while also refusing any other number makes the
   * screen a locked door with the key withheld — a driver who counts 2 of 3 can
   * neither pass nor find out what would let them. Showing it costs the blind
   * count and buys a driver who is never stuck.
   *
   * `totalQty` — the sum of every line's quantity — not `itemCount`, which
   * counts lines. A driver counts parcels on a trolley, so three boxes of the
   * same SKU is three, not one. Zero means the order lists no items at all,
   * which leaves nothing to compare against.
   */
  const expected = task?.totals.totalQty ?? 0;
  const counted = /^\d+$/.test(countText) ? Number(countText) : null;
  const mismatch = expected > 0 && counted !== null && counted !== expected;

  /**
   * The count must agree with the order before the stop can close.
   *
   * `expected > 0` guards an order with no items, where there is nothing to
   * match against and any positive count is accepted.
   */
  const ready =
    Boolean(photo && signature && signedByName) &&
    counted !== null &&
    counted > 0 &&
    !mismatch;

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
        void showDialog({
          title: 'Signature not saved',
          tone: 'danger',
          message: e instanceof Error ? e.message : 'Please try again.',
        });
      }
    },
    [],
  );

  const send = useCallback(
    async () => {
      if (!ready || !task || !photo || !signature || counted === null || busy) return;

      setBusy(true);
      try {
        await capture.mutateAsync({
          leg,
          photo,
          signature,
          signedByName,
          itemCount: counted,
          note: note.trim() || undefined,
          idempotencyKey,
        });

        // The signature file has served its purpose the moment the server has it.
        discardFile(signature.uri);
        setSignature(null);

        router.replace(`/task/${task.id}`);
      } catch (e) {
        const conflict = e instanceof ApiError && e.isConflict;
        void showDialog({
          title: conflict ? 'This stop is already closed' : 'Could not save the proof',
          tone: conflict ? 'warn' : 'danger',
          message: messageFor(e),
          actions: conflict
            ? [
                {
                  label: 'Back to job',
                  style: 'primary',
                  onPress: () => router.replace(`/task/${task.id}`),
                },
              ]
            : undefined,
        });
      } finally {
        setBusy(false);
      }
    },
    [
      ready,
      task,
      photo,
      signature,
      busy,
      capture,
      leg,
      signedByName,
      counted,
      note,
      idempotencyKey,
      router,
    ],
  );

  /**
   * The count is confirmed out loud even though it already matches.
   *
   * A number typed into a box is the easiest thing on this screen to get wrong —
   * it costs one keystroke and looks identical whether it is right or not, while
   * the photo and the signature are self-evidently what they are. And it is the
   * figure the consignment is reconciled against afterwards, at both ends: a
   * count taken at pickup and again at delivery is what turns "something went
   * missing" into "it went missing between these two stops".
   *
   * A mismatch never reaches here — the save button stays disabled and the field
   * shows the error instead. This dialog is the last look before a stop closes
   * for good.
   */
  const confirmAndSend = useCallback(() => {
    if (!ready || busy || counted === null) return;

    const pieces = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
    const verb = leg === 'PICKUP' ? 'picked up' : 'delivered';
    const finish = leg === 'PICKUP' ? 'Yes, complete pickup' : 'Yes, complete delivery';

    void showDialog({
      title: 'Confirm item count',
      tone: 'info',
      icon: 'package',
      message:
        `Are you sure you ${verb} ${pieces(counted)}? This matches the order, and it cannot be ` +
        'changed from the app once the proof is saved.',
      actions: [
        { label: finish, style: 'primary', onPress: () => void send() },
        { label: 'Count again', style: 'cancel' },
      ],
    });
  }, [ready, busy, counted, leg, send]);

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
          <View style={styles.labelRow}>
            <Tiny style={styles.label}>
              {leg === 'PICKUP' ? 'Number of items picked up' : 'Number of items delivered'}
            </Tiny>
            {/*
              The figure the count has to reach, stated up front. The save is
              blocked until they agree, so withholding it would leave a driver
              guessing at the one number that unlocks the screen.
            */}
            {expected > 0 ? (
              <Tiny style={styles.expected}>
                Order lists {expected} item{expected === 1 ? '' : 's'}
              </Tiny>
            ) : null}
          </View>
          <TextInput
            value={countText}
            // Stripped rather than merely filtered: a numeric keyboard still
            // offers a decimal point and a minus on some OEM keyboards, and
            // pasting is unrestricted on every one of them.
            onChangeText={(t) => setCountText(t.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="Count the parcels and enter the total"
            placeholderTextColor={color.faint}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={4}
            style={[styles.input, mismatch ? styles.inputWarn : null]}
            editable={!busy}
          />
          {mismatch ? (
            <View style={styles.mismatch}>
              <Icon name="alert-triangle" size={13} color={color.danger} />
              {/*
                Says that it is wrong, never what the right answer is — the whole
                value of the field is that the driver counts rather than copies.
              */}
              <Tiny style={styles.mismatchText}>
                Item count does not match this order. Count again.
              </Tiny>
            </View>
          ) : (
            <Tiny style={styles.help}>
              {leg === 'PICKUP'
                ? 'Count what you are actually taking, not what the order says.'
                : 'Count what you are actually handing over, not what the order says.'}
            </Tiny>
          )}
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

        {/*
          Always present, on both legs — not conditional on anything going wrong.

          A stop stalls in more ways than a bad count: goods refused, nobody
          willing to sign, an address that does not exist. Showing this only on a
          mismatch would answer one of those and leave the driver hunting for a
          number for the rest, and a help affordance that appears and disappears
          is one nobody learns to look for.
        */}
        <DispatchContact
          reason={
            leg === 'PICKUP'
              ? 'Something not right at this pickup? Dispatch can amend the order or tell you to move on.'
              : 'Something not right at this delivery? Dispatch can amend the order or tell you to move on.'
          }
        />
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
          onPress={confirmAndSend}
        />
        {!ready ? (
          <Tiny style={styles.saveHint}>
            {!signedByName
              ? leg === 'PICKUP'
                ? 'Enter who handed the parcel over.'
                : 'Enter who received the parcel.'
              : counted === null
                ? leg === 'PICKUP'
                  ? 'Enter how many items you are picking up.'
                  : 'Enter how many items you are delivering.'
                : !signature && !photo
                  ? 'Capture a signature and a photo to finish this stop.'
                  : !signature
                    ? 'A signature is still needed.'
                    : !photo
                      ? 'A photo is still needed.'
                      : 'The item count does not match this order.'}
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

          {proof.signedByName || proof.itemCount !== null ? (
            <View style={styles.proofFacts}>
              {proof.signedByName ? (
                <Small style={styles.proofFact}>
                  {leg === 'PICKUP' ? 'Handed over by' : 'Received by'}{' '}
                  <Small style={styles.proofFactValue}>{proof.signedByName}</Small>
                </Small>
              ) : null}
              {proof.itemCount !== null ? (
                <Small style={styles.proofFact}>
                  Items counted{' '}
                  <Small style={styles.proofFactValue}>{proof.itemCount}</Small>
                </Small>
              ) : null}
            </View>
          ) : null}

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
  expected: { fontFamily: font.medium, fontSize: 11.5, color: color.muted },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
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

  // Danger, not warning: this one blocks the save rather than cautioning about it.
  inputWarn: { borderColor: color.danger, backgroundColor: color.dangerSoft },
  mismatch: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  mismatchText: { flex: 1, fontSize: 11, color: color.dangerText, lineHeight: 15 },


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

  proofFacts: { paddingHorizontal: 18, paddingTop: 16, gap: 5 },
  proofFact: { color: color.muted, fontSize: 13 },
  proofFactValue: { color: color.ink, fontFamily: font.medium, fontSize: 13 },

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
