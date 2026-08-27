import { View, type ViewProps, type ViewStyle, StyleSheet } from 'react-native';
import { color, radius, shadow } from '@/theme/tokens';

/** The mockup's `.card` — white, hairline border, soft lift, 16px radius. */
export function Card({ style, ...rest }: ViewProps & { style?: ViewStyle | ViewStyle[] }) {
  return <View {...rest} style={[styles.card, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...shadow.card,
  },
});
