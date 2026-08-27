import Feather from '@expo/vector-icons/Feather';
import { color } from '@/theme/tokens';

/**
 * The mockups are drawn with Feather's icon set — the inline SVG paths in the
 * HTML are Feather's verbatim — so using it here reproduces them exactly rather
 * than approximating.
 */
export type IconName = React.ComponentProps<typeof Feather>['name'];

interface Props {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 18, color: tint = color.muted }: Props) {
  return <Feather name={name} size={size} color={tint} />;
}
