import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { Display, Tiny } from './Text';

/** The `.appbar` from the Complete Task and Items mockups. */
interface Props {
  title: string;
  /** The right-hand pill — "Pickup" / "Delivery" on the Complete Task screen. */
  tag?: string;
  onBack?: () => void;
}

export function ScreenHeader({ title, tag, onBack }: Props) {
  const router = useRouter();

  const back = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={back}
        hitSlop={8}
        style={({ pressed }) => [styles.iconBtn, pressed ? styles.pressed : null]}
      >
        <Icon name="chevron-left" size={22} color={color.ink} />
      </Pressable>

      <Display numberOfLines={1} style={styles.title}>
        {title}
      </Display>

      {tag ? (
        <View style={styles.tag}>
          <Tiny style={styles.tagLabel}>{tag}</Tiny>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
    paddingRight: 14,
    paddingBottom: 12,
    paddingTop: 4,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: color.surfaceSoft },
  title: { flex: 1 },
  tag: {
    borderRadius: radius.pill,
    backgroundColor: color.primarySoft,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  tagLabel: {
    fontFamily: font.monoBold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: color.primary,
  },
});
