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
 * The bar spans the page and the choices are spread evenly across it, but the
 * pill hugs its own label: "Live" is highlighted to the width of the word, not
 * to the third of the bar its tab occupies. So two boxes are measured, not one
 * — the tab for where it sits, the label within it for how wide to draw — and
 * the pill is animated onto whichever is chosen, the way the tab bar moves its
 * own.
 *
 * The tabs keep a full-height touch target either side of the text, so the
 * tighter pill costs nothing in accuracy.
 */
export function SegmentedTabs<Value extends string>({ options, value, onChange, label }: Props<Value>) {
  const styles = useThemedStyles(stylesheet);
  // Where each tab sits, and how much room its label takes inside it.
  const [tabs, setTabs] = useState<Record<number, LayoutRectangle>>({});
  const [labels, setLabels] = useState<Record<number, LayoutRectangle>>({});
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const tab = tabs[index];
  const label_ = labels[index];
  // The label's own offset is measured from its tab, so the two add up to a
  // position along the bar.
  const box = tab && label_ ? { x: tab.x + label_.x, width: label_.width } : null;

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
              setTabs((current) => current[position]?.width === next.width && current[position]?.x === next.x ? current : { ...current, [position]: next });
            }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            {/* The pill's footprint: the word and the room either side of it. */}
            <View
              onLayout={(event) => {
                const next = event.nativeEvent.layout;
                setLabels((current) => current[position]?.width === next.width && current[position]?.x === next.x ? current : { ...current, [position]: next });
              }}
              style={styles.hug}
            >
              <Text numberOfLines={1} style={[styles.label, selected && styles.labelOn]}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // Spans the page, as the row it replaced did.
  bar: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', padding: theme.spacing.xs },
  // Behind the labels, so the chosen one reads through it.
  pill: { backgroundColor: colors.accent, borderRadius: theme.radius.pill, bottom: theme.spacing.xs, position: 'absolute', top: theme.spacing.xs },
  // Grows from the width of its own label rather than taking a fixed share, so
  // the row spreads across the bar without a long word being given less room
  // than it needs — an equal share left "Upcoming" over its own on a narrow
  // phone. The whole share is the touch target; only the pill inside is tight.
  tab: { alignItems: 'center', flexBasis: 'auto', flexGrow: 1, justifyContent: 'center', minHeight: theme.touch.minimum },
  hug: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  label: { color: colors.textSecondary, fontSize: theme.type.body, fontWeight: '800' },
  labelOn: { color: colors.onAccent, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
