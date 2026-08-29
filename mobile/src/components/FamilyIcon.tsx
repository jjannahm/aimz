import Svg, { Circle, Path } from 'react-native-svg';

import { useColors } from '@/src/theme/ThemeProvider';

type Props = {
  color?: string;
  size?: number;
};

/**
 * A family at icon scale: two adults frame a smaller child in front.
 *
 * The separated strokes keep the child legible at the 20px size used in
 * roster actions, while the single colour lets the button own its contrast.
 */
export function FamilyIcon({ color, size = 20 }: Props) {
  const colors = useColors();
  const ink = color ?? colors.textPrimary;
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no"
      testID="family-icon"
      viewBox="0 0 24 24"
      width={size}
    >
      <Circle cx="6.5" cy="6" fill={ink} r="2.5" />
      <Circle cx="17.5" cy="6" fill={ink} r="2.5" />
      <Path d="M1.8 17.8c.2-4.5 1.8-7.1 4.7-7.1 2 0 3.4 1.2 4.1 3.3" fill="none" stroke={ink} strokeLinecap="round" strokeWidth="2.4" />
      <Path d="M22.2 17.8c-.2-4.5-1.8-7.1-4.7-7.1-2 0-3.4 1.2-4.1 3.3" fill="none" stroke={ink} strokeLinecap="round" strokeWidth="2.4" />
      <Circle cx="12" cy="11.2" fill={ink} r="2" />
      <Path d="M8.6 20.3c.1-4 1.3-6.3 3.4-6.3s3.3 2.3 3.4 6.3" fill="none" stroke={ink} strokeLinecap="round" strokeWidth="2.4" />
    </Svg>
  );
}
