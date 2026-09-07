import { Pressable, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { demoApi } from '@/features/demo/demoApi';
import { env } from '@/lib/env';
import { color, font } from '@/theme/tokens';
import { showDialog } from './Dialog';
import { Icon } from './Icon';
import { Tiny } from './Text';

/**
 * A permanent strip across the top of the app while it is running on fixtures.
 *
 * Deliberately impossible to miss. A demo build that looks identical to the real
 * one is how somebody ends up telling a customer their parcel was delivered
 * because a screen said so — the whole point of this app is that a status is
 * evidence, and fixture data is not evidence.
 *
 * Tapping it resets the run, so the same walkthrough can be given twice.
 */
export function DemoBanner() {
  const qc = useQueryClient();
  if (!env.demo) return null;

  const reset = () => {
    void showDialog({
      title: 'Reset demo data?',
      tone: 'warn',
      icon: 'refresh-cw',
      message: 'Puts the three sample jobs back to their starting state.',
      actions: [
        {
          label: 'Reset',
          style: 'danger',
          onPress: () => {
            demoApi.reset();
            void qc.invalidateQueries();
          },
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Demo mode. Sample data only. Tap to reset."
      onPress={reset}
      style={styles.bar}
    >
      <Icon name="alert-triangle" size={13} color={color.warn} />
      <Tiny style={styles.text}>DEMO — sample data, no server. Tap to reset.</Tiny>
      <Icon name="rotate-ccw" size={13} color={color.warn} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: color.warnSoft,
    borderBottomWidth: 1,
    borderBottomColor: '#F2DFC0',
  },
  text: { fontFamily: font.bold, fontSize: 10.5, color: color.warn, letterSpacing: 0.3 },
});
