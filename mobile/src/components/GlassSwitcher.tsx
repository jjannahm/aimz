import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle } from 'react-native';

import { GlassSurface } from '@/src/components/GlassSurface';
import { useReduceMotion } from '@/src/lib/useReduceMotion';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Option<Value extends string> = { label: string; value: Value };

type Props<Value extends string> = {
  options: readonly Option<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  label?: string;
};

/**
 * A glass capsule with a lens sliding under whichever section is open.
 *
 * Kept apart from the shared `SegmentedControl` because only the screens asked
 * for it are glass — the rest of the app keeps flat surfaces, and one component
 * cannot be both.
 *
 * A tab grows from the width of its own name rather than taking a fixed share:
 * an equal third of a phone cannot hold "Leaderboards" at any size worth
 * reading, and it was being cut short. That makes the tabs different widths, so
 * each reports its own box and the lens is animated onto whichever is open.
 */
export function GlassSwitcher<Value extends string>({ options, value, onChange, label }: Props<Value>) {
  const styles = useThemedStyles(stylesheet);
  const reduceMotion = useReduceMotion();
  const [boxes, setBoxes] = useState<Record<number, LayoutRectangle>>({});
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const box = boxes[index];

  useEffect(() => {
    if (!box) return undefined;
    if (!settled.current || reduceMotion) {
      left.setValue(box.x);
      width.setValue(box.width);
      settled.current = true;
      return undefined;
    }
    // Off the native driver, which cannot carry a position and a width — the
    // cost of a lens that fits its name rather than a fixed share.
    const animation = Animated.parallel([
      Animated.spring(left, { bounciness: 0, speed: 14, toValue: box.x, useNativeDriver: false }),
      Animated.spring(width, { bounciness: 0, speed: 14, toValue: box.width, useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [box?.x, box?.width, box, reduceMotion, left, width]);
  return (
    <GlassSurface intensity={45} radius={999} style={styles.capsule}>
      <View accessibilityLabel={label} accessibilityRole="tablist" style={styles.track}>
        {box ? <Animated.View pointerEvents="none" style={[styles.lens, { left, width }]} /> : null}
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
    </GlassSurface>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  capsule: { padding: theme.spacing.xs },
  track: { flexDirection: 'row', position: 'relative' },
  // The lens: the accent at a strength that tints rather than fills, so the
  // section's name reads through it as the same near-white it was.
  lens: {
    backgroundColor: colors.selectionSurface,
    borderColor: colors.glassBorder,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    opacity: 0.55,
    position: 'absolute',
    top: 0,
  },
  // Grows from its own name, so no label is squeezed into a share too small
  // for it; the whole of it stays tappable either way.
  tab: { alignItems: 'center', flexBasis: 'auto', flexGrow: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  labelOn: { color: colors.textPrimary, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
