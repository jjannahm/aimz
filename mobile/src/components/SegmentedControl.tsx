import { Pressable, StyleSheet, Text, View } from 'react-native';

import { noFocusRing, theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export type SegmentedOption<Value extends string> = {
  accessibilityLabel?: string;
  label: string;
  value: Value;
};

type Props<Value extends string> = {
  /** Read out to describe what the row switches between. */
  label?: string;
  onChange: (value: Value) => void;
  /** Readonly, so a caller can declare its choices `as const`. */
  options: readonly SegmentedOption<Value>[];
  value: Value;
};

/**
 * A fixed row of tabs inside one capsule.
 *
 * Every tab owns an equal share of the bar. The selected colour fills that
 * entire share, while the bar's clipping supplies the rounded outside corners.
 */
export function SegmentedControl<Value extends string>({ label, onChange, options, value }: Props<Value>) {
  const styles = useThemedStyles(stylesheet);

  return (
    <View accessibilityLabel={label} accessibilityRole="tablist" style={styles.bar}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.accessibilityLabel}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.segment, selected && styles.segmentOn, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 0,
    overflow: 'hidden',
    padding: 0,
  },
  segment: {
    ...noFocusRing,
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: theme.touch.minimum,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  segmentOn: { backgroundColor: colors.accent },
  label: { color: colors.textSecondary, fontSize: theme.type.body, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  labelOn: { color: colors.onAccent, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
