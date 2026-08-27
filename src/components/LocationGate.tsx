import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocationReadiness, type LocationStatus } from '@/features/location/readiness';
import { color, font, radius } from '@/theme/tokens';
import { PrimaryButton, SecondaryButton } from './Button';
import { Icon } from './Icon';
import { Body, Display, Small } from './Text';

/**
 * Location is a precondition for this app, not a feature of it.
 *
 * A courier app whose position is optional is a dispatch board that lies: the
 * map shows a driver who may or may not be where the pin says, and the nearest-
 * driver ranking silently excludes whoever declined. So rather than degrade,
 * the app stops here and says exactly what is missing and how to fix it.
 *
 * Deliberately NOT a modal or a toast. Both are dismissible, and a dismissed
 * prompt becomes a driver working untracked for a whole shift.
 *
 * The gate is skipped entirely in demo mode: there is no dispatch to report to,
 * and demanding "allow all the time" from someone reviewing the design would be
 * the app taking something it has no use for.
 */

interface Copy {
  icon: 'map-pin' | 'alert-triangle' | 'settings';
  title: string;
  body: string;
  action: string;
}

const COPY: Record<Exclude<LocationStatus, 'ready' | 'checking'>, Copy> = {
  'services-off': {
    icon: 'alert-triangle',
    title: 'Turn on location',
    body:
      'Location is switched off on this phone. Innovo Xpress needs it to show dispatch where you are and to route the nearest job to you.',
    action: 'Turn on location',
  },
  denied: {
    icon: 'map-pin',
    title: 'Allow location access',
    body:
      'Innovo Xpress shares your position with dispatch while you are working, so jobs can be routed to the nearest driver and customers can be told when you are close.',
    action: 'Allow location',
  },
  blocked: {
    icon: 'settings',
    title: 'Location is blocked',
    body:
      'Location permission was turned off for this app, and only the Settings app can turn it back on. Open Settings, choose Permissions, then Location.',
    action: 'Open settings',
  },
};

export function LocationGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { status, background, request, openSettings, requesting } = useLocationReadiness(enabled);

  if (!enabled) return <>{children}</>;

  // Nothing at all while the first read is in flight: a prompt that flashes up
  // and vanishes reads as a bug, and this resolves in milliseconds.
  if (status === 'checking') return <View style={styles.blank} />;

  if (status === 'ready') {
    if (background) return <>{children}</>;

    // Wrapped rather than returned as a bare sibling: the app below is a flex
    // child expecting to fill its parent, and appending a second child to an
    // unmanaged column is how a strip like this silently squashes the screen.
    return (
      <View style={styles.stack}>
        <View style={styles.stack}>{children}</View>
        <ForegroundOnlyNotice onPress={openSettings} insetBottom={insets.bottom} />
      </View>
    );
  }

  const copy = COPY[status];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.badge}>
        <Icon name={copy.icon} size={30} color={color.primary} />
      </View>

      <Display style={styles.title}>{copy.title}</Display>
      <Body style={styles.body}>{copy.body}</Body>

      <View style={styles.actions}>
        <PrimaryButton
          label={copy.action}
          icon="map-pin"
          loading={requesting}
          onPress={status === 'blocked' ? openSettings : () => void request()}
        />
      </View>

      <Small style={styles.foot}>
        Your position is only sent while you are signed in, and is visible to
        dispatch — never to customers.
      </Small>
    </View>
  );
}

/**
 * "While using the app" is workable but degraded: the moment the screen locks,
 * dispatch stops hearing from this driver. Worth saying once, persistently, and
 * without blocking — the OS treats it as a separate decision and so should we.
 */
function ForegroundOnlyNotice({
  onPress,
  insetBottom,
}: {
  onPress: () => void;
  insetBottom: number;
}) {
  return (
    <View style={[styles.notice, { paddingBottom: 10 + insetBottom }]}>
      <Icon name="alert-triangle" size={15} color={color.warn} />
      <Small style={styles.noticeText}>
        Background location is off, so your position stops updating when the screen locks.
      </Small>
      <SecondaryButton label="Fix" onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: color.bgCanvas },
  stack: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: color.bgCanvas,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  badge: {
    width: 68,
    height: 68,
    borderRadius: radius.card,
    backgroundColor: color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', color: color.muted, lineHeight: 21 },
  actions: { alignSelf: 'stretch', marginTop: 10 },
  foot: { textAlign: 'center', color: color.faint, marginTop: 4 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: color.warnSoft,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  noticeText: { flex: 1, color: color.ink, fontFamily: font.medium },
});
