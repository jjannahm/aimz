import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export type SegmentedOption<Value extends string> = { label: string; value: Value };

type Props<Value extends string> = {
  /** Readonly, so a caller can declare its choices `as const`. */
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /** Read out to describe what the row switches between. */
  label?: string;
};

/**
 * A row of choices inside one capsule, with the chosen one wearing a pill.
 *
 * The pill hugs its own label rather than taking an equal share of the row, so
 * "Live" is the width of the word and not a third of the bar. That makes the
 * tabs different widths, which is why the pill cannot be placed by fraction:
 * each tab reports its own box as it lays out and the pill is animated onto
 * whichever is chosen, the way the tab bar moves its own.
 *
 * The tabs keep a full-height touch target either side of the text, so the
 * tighter pill costs nothing in accuracy.
 */
export function SegmentedTabs<Value extends string>({ options, value, onChange, label }: Props<Value>) {
  const styles = useThemedStyles(stylesheet);
  const [boxes, setBoxes] = useState<Record<number, LayoutRectangle>>({});
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const box = boxes[index];

  useEffect(() => {
    if (!box) return;
    // The first measurement places the pill outright; a change slides it.
    if (!settled.current) {
      left.setValue(box.x);
      width.setValue(box.width);
      settled.current = true;
      return;
    }
    Animated.parallel([
      Animated.spring(left, { bounciness: 0, speed: 16, toValue: box.x, useNativeDriver: false }),
      Animated.spring(width, { bounciness: 0, speed: 16, toValue: box.width, useNativeDriver: false }),
    ]).start();
  }, [box?.x, box?.width, left, width, box]);

  return (
    <View accessibilityLabel={label} accessibilityRole="tablist" style={styles.bar}>
      {box ? <Animated.View style={[styles.pill, { left, width }]} /> : null}
      {options.map((option, position) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onLayout={(event) => {
              const next = event.nativeEvent.layout;
              setBoxes((current) => current[position]?.width === next.width && current[position]?.x === next.x ? current : { ...current, [position]: next });
            }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  bar: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', maxWidth: '100%', padding: theme.spacing.xs },
  // Behind the labels, so the chosen one reads through it.
  pill: { backgroundColor: colors.accent, borderRadius: theme.radius.pill, bottom: theme.spacing.xs, position: 'absolute', top: theme.spacing.xs },
  tab: { alignItems: 'center', justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md },
  label: { color: colors.textSecondary, fontWeight: '800' },
  labelOn: { color: colors.onAccent, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
