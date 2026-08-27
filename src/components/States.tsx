import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ApiError } from '@/api/client';
import { color, font, radius } from '@/theme/tokens';
import { SecondaryButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Body, Title } from './Text';

/** Loading, empty and error, styled once so every screen fails the same way. */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.centre}>
      <ActivityIndicator color={color.primary} />
      <Body style={styles.dim}>{label}</Body>
    </View>
  );
}

export function EmptyState({
  icon = 'check-circle',
  title,
  message,
}: {
  icon?: IconName;
  title: string;
  message?: string;
}) {
  return (
    <View style={styles.centre}>
      <View style={styles.badge}>
        <Icon name={icon} size={26} color={color.primary} />
      </View>
      <Title style={styles.centreText}>{title}</Title>
      {message ? <Body style={[styles.dim, styles.centreText]}>{message}</Body> : null}
    </View>
  );
}

/**
 * The message shown to the driver comes from the server whenever there is one —
 * "Pickup proof can only be captured when the order is At Pickup" is far more
 * useful than "Something went wrong", and the backend already writes it.
 */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'This job is not assigned to you any more. Pull down to refresh your list.';
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.isOffline;

  return (
    <View style={styles.centre}>
      <View style={[styles.badge, styles.badgeWarn]}>
        <Icon name={offline ? 'wifi-off' : 'alert-triangle'} size={26} color={color.dangerText} />
      </View>
      <Title style={styles.centreText}>{offline ? 'No connection' : 'That did not work'}</Title>
      <Body style={[styles.dim, styles.centreText]}>{messageFor(error)}</Body>
      {onRetry ? <SecondaryButton label="Try again" icon="refresh-cw" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  centreText: { textAlign: 'center' },
  dim: { color: color.muted, fontFamily: font.regular },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWarn: { backgroundColor: color.dangerSoft },
});
