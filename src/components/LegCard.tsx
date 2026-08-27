import { Pressable, StyleSheet, View } from 'react-native';
import { color, font, radius } from '@/theme/tokens';
import { callNumber, openNavigation, sendEmail, shareStop, type Destination } from '@/lib/navigate';
import { Card } from './Card';
import { ContactRow } from './ContactRow';
import { Icon } from './Icon';
import { Body, SectionLabel, Small, Tiny } from './Text';

/**
 * One end of the job — the `.loc` block from the Task info mockup.
 *
 * Pickup and delivery are the same component because they are the same thing
 * twice: an address, an instruction the driver must read before knocking, and a
 * person to contact. Only the accent colour and the "done" badge differ.
 */
export interface LegCardProps {
  kind: 'pickup' | 'delivery';
  /** "Purolator — YVR Hub" or the receiver's name. */
  name: string;
  address: string;
  sub?: string | null;
  instructions?: string | null;
  phone?: string | null;
  email?: string | null;
  destination: Destination;
  done?: boolean;
  /** Shown when the leg is done — the mockup's green "Picked up" pill. */
  doneLabel?: string;
  showShare?: boolean;
}

export function LegCard({
  kind,
  name,
  address,
  sub,
  instructions,
  phone,
  email,
  destination,
  done = false,
  doneLabel,
  showShare = false,
}: LegCardProps) {
  const isPickup = kind === 'pickup';

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: isPickup ? color.muted : color.primary }]} />
        <SectionLabel style={styles.headLabel} numberOfLines={1}>
          {isPickup ? 'Pickup · dispatch location' : 'Delivery · destination'}
        </SectionLabel>

        {done && doneLabel ? (
          <View style={styles.doneBadge}>
            <Icon name="check" size={11} color={color.successText} />
            <Tiny style={styles.doneLabel}>{doneLabel}</Tiny>
          </View>
        ) : null}

        <View style={styles.actions}>
          {showShare ? (
            <IconAction
              label="Share this stop"
              icon="share"
              onPress={() => void shareStop(destination)}
            />
          ) : null}
          <IconAction
            label={`Navigate to ${isPickup ? 'pickup' : 'delivery'}`}
            icon="navigation"
            onPress={() => void openNavigation(destination)}
          />
        </View>
      </View>

      <Body style={styles.address}>{address}</Body>
      {sub ? <Small style={styles.sub}>{sub}</Small> : null}

      {instructions ? (
        <View style={styles.instr}>
          <Icon name="info" size={15} color={color.muted} />
          <Body style={styles.instrText}>{instructions}</Body>
        </View>
      ) : null}

      <View style={styles.contact}>
        <ContactRow icon={isPickup ? 'home' : 'user'} text={name} strong />
        {phone ? (
          <ContactRow icon="phone" text={phone} href={`tel:${phone.replace(/\s+/g, '')}`} mono />
        ) : null}
        {email ? <ContactRow icon="mail" text={email} href={`mailto:${email}`} mono /> : null}
      </View>

      {phone || email ? (
        <View style={styles.quick}>
          {phone ? (
            <QuickLink label="Call" icon="phone" onPress={() => callNumber(phone)} />
          ) : null}
          {email ? (
            <QuickLink
              label="Email"
              icon="mail"
              onPress={() => sendEmail(email, `Innovo Xpress delivery — ${name}`)}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function IconAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'share' | 'navigation';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconAction, pressed ? styles.iconActionOn : null]}
    >
      <Icon name={icon} size={16} color={color.primary} />
    </Pressable>
  );
}

function QuickLink({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'phone' | 'mail';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickBtn, pressed ? styles.quickBtnOn : null]}
    >
      <Icon name={icon} size={14} color={color.primary} />
      <Tiny style={styles.quickLabel}>{label}</Tiny>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 15, gap: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  headLabel: { flex: 1 },
  actions: { flexDirection: 'row', gap: 6 },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionOn: { backgroundColor: color.surfaceSoft },

  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: color.successSoft,
    borderWidth: 1,
    borderColor: color.successBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  doneLabel: { fontFamily: font.bold, fontSize: 11, color: color.successText },

  address: { fontSize: 16, fontFamily: font.semibold, color: color.ink, lineHeight: 22 },
  sub: { marginTop: 3 },

  instr: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 11,
    padding: 11,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSoft,
  },
  instrText: { flex: 1, fontSize: 13, color: color.body, lineHeight: 19 },

  contact: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: color.line2,
    gap: 9,
  },

  quick: { flexDirection: 'row', gap: 8, marginTop: 12 },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    // minHeight: this pill carries a label that grows with the OS text size.
    minHeight: 32,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: color.primarySoft,
  },
  quickBtnOn: { backgroundColor: color.primaryPressed },
  quickLabel: { fontFamily: font.bold, fontSize: 12, color: color.primary },
});
