import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { color, font } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Body } from './Text';

/**
 * A name / phone / email line inside a leg card.
 *
 * Phone and email are links: on this job the driver is standing outside a
 * building being told to call, and making them retype a number is the difference
 * between the app being used and being worked around.
 */
interface Props {
  icon: IconName;
  text: string;
  href?: string;
  strong?: boolean;
  mono?: boolean;
}

export function ContactRow({ icon, text, href, strong = false, mono = false }: Props) {
  const open = href ? () => void Linking.openURL(href).catch(() => undefined) : undefined;

  const label = (
    <Body
      style={[
        styles.text,
        strong ? styles.strong : null,
        mono ? styles.mono : null,
        href ? styles.link : null,
      ]}
      numberOfLines={1}
    >
      {text}
    </Body>
  );

  const inner = (
    <>
      <View style={styles.tile}>
        <Icon name={icon} size={15} color={color.muted} />
      </View>
      {label}
    </>
  );

  if (!open) return <View style={styles.row}>{inner}</View>;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={text}
      onPress={open}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.6 } : null]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: color.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, fontSize: 14, color: color.body },
  strong: { color: color.ink, fontFamily: font.semibold },
  mono: { fontFamily: font.mono, fontSize: 13 },
  link: { color: color.primary },
});
