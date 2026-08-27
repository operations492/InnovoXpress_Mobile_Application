import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DetailRow } from '@/components/DetailRow';
import { SecondaryButton } from '@/components/Button';
import { ShiftStatus } from '@/components/ShiftStatus';
import { Body, Display, Mono, SectionLabel, Small, Tiny } from '@/components/Text';
import * as buffer from '@/features/location/buffer';
import * as tracking from '@/features/location/tracking';
import { useMe } from '@/features/tasks/queries';
import { env } from '@/lib/env';
import { formatStamp, initials } from '@/lib/format';
import { useAuth } from '@/state/AuthProvider';
import { useShift } from '@/state/ShiftProvider';
import { color, font } from '@/theme/tokens';

/**
 * Profile, shift, and the honest state of the things the driver cannot see.
 *
 * The queued-fixes row exists because GPS failures are silent by nature: a
 * driver whose phone has been buffering for two hours has no other way to find
 * out, and dispatch wondering why a van vanished is the expensive version of
 * that conversation.
 */
export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { onShift, tracking: isTracking } = useShift();
  const { data: me, isRefetching, refetch } = useMe();

  const [queued, setQueued] = useState(0);
  const [flushing, setFlushing] = useState(false);

  const refreshQueue = useCallback(async () => {
    setQueued(await buffer.size());
  }, []);

  useEffect(() => {
    /*
     * The queue depth lives in a native store, not in React, so polling is the
     * only way to observe it and there is nothing to derive during render.
     *
     * The rule below fires on the shape, not the behaviour: `refreshQueue`
     * awaits `buffer.size()` before it sets anything, so the state change lands
     * in a later tick and cannot cascade the render this effect belongs to —
     * which is the thing the rule exists to prevent.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: setState runs after an await, not during this render
    void refreshQueue();
    const timer = setInterval(() => void refreshQueue(), 10_000);
    return () => clearInterval(timer);
  }, [refreshQueue]);

  const flushNow = useCallback(async () => {
    setFlushing(true);
    try {
      await tracking.flush();
    } finally {
      setFlushing(false);
      await refreshQueue();
    }
  }, [refreshQueue]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      'Sign out?',
      onShift
        ? 'This ends your shift and stops sharing your position. You will need your email and password to get back in.'
        : 'You will need your email and password to get back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }, [onShift, signOut]);

  const driver = me?.driver;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={color.primary}
          colors={[color.primary]}
        />
      }
    >
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Body style={styles.avatarText}>{me?.name ? initials(me.name) : '··'}</Body>
        </View>
        <View style={styles.profileText}>
          <Display style={styles.name} numberOfLines={1}>
            {me?.name ?? 'Loading…'}
          </Display>
          <Small numberOfLines={1}>{me?.email ?? ''}</Small>
          <View style={styles.badges}>
            <Chip label={me?.role ?? 'driver'} tone="primary" />
            {driver?.code ? <Chip label={driver.code} tone="mono" /> : null}
            {me && !me.active ? <Chip label="Deactivated" tone="danger" /> : null}
          </View>
        </View>
      </View>

      <SectionLabel style={styles.sectionLabel}>Shift</SectionLabel>
      <Card style={styles.card}>
        <View style={styles.shiftRow}>
          <View style={styles.shiftText}>
            <Body style={styles.shiftTitle}>
              {onShift ? 'You are on shift' : 'Starting your shift'}
            </Body>
            <Tiny style={styles.shiftSub}>
              {onShift
                ? isTracking
                  ? 'Your shift runs while the app is open. Dispatch can see your position and assign you work. Sign out to end it.'
                  : 'Marked on shift, but this phone is not reporting a position. Check location permissions.'
                : 'Your shift starts automatically. Waiting for dispatch to confirm — this needs a connection.'}
            </Tiny>
          </View>
          <ShiftStatus />
        </View>
      </Card>

      <SectionLabel style={styles.sectionLabel}>Position reporting</SectionLabel>
      <Card style={styles.card}>
        <DetailRow
          icon={isTracking ? 'navigation' : 'navigation-2'}
          label="Status"
          value={isTracking ? 'Reporting' : 'Not reporting'}
          accent={isTracking}
        />
        <DetailRow
          icon="upload-cloud"
          label="Waiting to send"
          value={queued === 0 ? 'Nothing queued' : `${queued} fix${queued === 1 ? '' : 'es'}`}
          sub={
            queued === 0
              ? 'Everything captured has reached dispatch.'
              : 'Saved on this phone until the signal comes back. Tap to try now.'
          }
          onPress={queued === 0 || flushing ? undefined : () => void flushNow()}
        />
        <DetailRow
          icon="clock"
          label="Reporting every"
          value={`${Math.round(env.locationIntervalMs / 1000)} seconds`}
          sub={
            isTracking
              ? 'Shared for as long as you are signed in. Sign out to stop it.'
              : 'Not reporting. Check that location is allowed for this app.'
          }
          last
        />
      </Card>

      <SectionLabel style={styles.sectionLabel}>Account</SectionLabel>
      <Card style={styles.card}>
        {driver ? (
          <DetailRow icon="truck" label="Driver record" value={driver.name} mono={false} />
        ) : (
          <DetailRow
            icon="alert-triangle"
            label="Driver record"
            value="Not linked"
            sub="This login is not attached to a driver on the roster, so no work will appear. Ask an admin to link it."
          />
        )}
        <DetailRow icon="server" label="API" value={env.apiUrl} mono last />
      </Card>

      <View style={styles.actions}>
        <SecondaryButton label="Sign out" icon="log-out" tone="danger" onPress={confirmSignOut} />
      </View>

      <Mono style={styles.version}>
        Innovo Xpress Driver {Constants.expoConfig?.version ?? '1.0.0'}
        {'  ·  '}
        {formatStamp(new Date().toISOString())}
      </Mono>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas },
  content: { paddingHorizontal: 14 },

  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.display, fontSize: 20, color: color.onPrimary },
  profileText: { flex: 1, gap: 3 },
  name: { fontSize: 20 },
  badges: { flexDirection: 'row', gap: 7, marginTop: 5, flexWrap: 'wrap' },

  sectionLabel: { marginTop: 20, marginBottom: 8, marginHorizontal: 4 },
  card: { marginHorizontal: 0 },

  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 15,
  },
  shiftText: { flex: 1, gap: 3 },
  shiftTitle: { fontFamily: font.semibold, fontSize: 15, color: color.ink },
  shiftSub: { lineHeight: 16, color: color.muted },

  actions: { marginTop: 22, gap: 10 },
  version: {
    marginTop: 18,
    textAlign: 'center',
    fontFamily: font.mono,
    fontSize: 11,
    color: color.faint,
  },
});
