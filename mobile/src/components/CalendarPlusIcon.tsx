import Svg, { Line, Path, Rect } from 'react-native-svg';

import { useColors } from '@/src/theme/ThemeProvider';

type Props = {
  color?: string;
  size?: number;
};

/**
 * A calendar with a plus in it: add this to your own calendar.
 *
 * Drawn rather than taken from Ionicons, which has calendar glyphs and add
 * glyphs but nothing that combines them. Follows `FamilyIcon`: one colour, so
 * the button it sits in owns the contrast, and strokes heavy enough to hold at
 * the 22px the header uses.
 *
 * The plus sits inside the page rather than badged on a corner, which stays
 * legible at this size where a badge would close up into a blob.
 */
export function CalendarPlusIcon({ color, size = 22 }: Props) {
  const colors = useColors();
  const ink = color ?? colors.textPrimary;
  return (
    <Svg
      accessibilityElementsHidden
      height={size}
      importantForAccessibility="no"
      testID="calendar-plus-icon"
      viewBox="0 0 24 24"
      width={size}
    >
      <Rect fill="none" height="16.5" rx="3" stroke={ink} strokeWidth="1.9" width="18.5" x="2.75" y="4.75" />
      {/* The two hangers, and the rule under the month's name. */}
      <Line stroke={ink} strokeLinecap="round" strokeWidth="1.9" x1="7.75" x2="7.75" y1="2.5" y2="6" />
      <Line stroke={ink} strokeLinecap="round" strokeWidth="1.9" x1="16.25" x2="16.25" y1="2.5" y2="6" />
      <Line stroke={ink} strokeWidth="1.9" x1="2.75" x2="21.25" y1="9.5" y2="9.5" />
      <Path d="M12 12.4v5.6M9.2 15.2h5.6" stroke={ink} strokeLinecap="round" strokeWidth="1.9" />
    </Svg>
  );
}
