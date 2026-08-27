import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, font } from '@/theme/tokens';
import { Icon } from './Icon';
import { Tiny } from './Text';

/**
 * What sits where the map goes when there is no map to draw.
 *
 * Two callers, two reasons:
 *
 *  - `maps.web.tsx` — `react-native-maps` ships no web build at all.
 *  - the Map and Task screens — no Google Maps API key was compiled in, so the
 *    native view would throw on inflate (see `mapsConfig.ts`).
 *
 * Deliberately a VISIBLE placeholder rather than an empty box: the map is a real
 * part of the layout, and collapsing it would make the surrounding spacing look
 * broken when it is not.
 */
export function MapPlaceholder({
  style,
  title,
  detail,
}: {
  style?: StyleProp<ViewStyle>;
  title: string;
  detail: string;
}) {
  return (
    <View style={[styles.placeholder, style]}>
      <Icon name="map" size={22} color={color.faint} />
      <Tiny style={styles.text}>{title}</Tiny>
      <Tiny style={styles.sub}>{detail}</Tiny>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#E4E7EC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  text: { fontFamily: font.bold, fontSize: 11.5, color: color.muted, textAlign: 'center' },
  sub: { fontSize: 11, color: color.faint, textAlign: 'center' },
});
