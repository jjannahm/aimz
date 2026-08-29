import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle } from 'react-native';

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
 * Every tab owns an equal share of the bar. One indicator sits behind the row
 * and slides onto the selected tab, while the bar's clipping supplies the
 * rounded outside corners.
 */
export function SegmentedControl<Value extends string>({ label, onChange, options, value }: Props<Value>) {
  const styles = useThemedStyles(stylesheet);
  const [boxes, setBoxes] = useState<Partial<Record<Value, LayoutRectangle>>>({});
  const [reduceMotion, setReduceMotion] = useState(true);
  const translateX = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);
  const previousValue = useRef(value);
  const box = boxes[value];

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!box) return undefined;

    translateX.stopAnimation();
    const selectionChanged = settled.current && previousValue.current !== value;
    previousValue.current = value;
    settled.current = true;

    // First layout, responsive relayouts, and reduced-motion changes should
    // place the indicator directly. Only a real tab change travels across.
    if (!selectionChanged || reduceMotion) {
      translateX.setValue(box.x);
      return undefined;
    }

    const animation = Animated.spring(translateX, {
      bounciness: 0,
      speed: 16,
      toValue: box.x,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [box?.width, box?.x, reduceMotion, translateX, value]);

  return (
    <View accessibilityLabel={label} accessibilityRole="tablist" style={styles.bar}>
      {box ? (
        <Animated.View
          accessible={false}
          pointerEvents="none"
          style={[styles.indicator, { transform: [{ translateX }], width: box.width }]}
          testID="segmented-control-indicator"
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.accessibilityLabel}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onLayout={(event) => {
              const next = event.nativeEvent.layout;
              setBoxes((current) => {
                const previous = current[option.value];
                return previous?.x === next.x && previous.width === next.width
                  ? current
                  : { ...current, [option.value]: next };
              });
            }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.segment, pressed && styles.pressed]}
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
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 0,
    overflow: 'hidden',
    padding: theme.spacing.xs,
  },
  indicator: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    bottom: theme.spacing.xs,
    left: 0,
    position: 'absolute',
    top: theme.spacing.xs,
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
  label: { color: colors.textSecondary, fontFamily: theme.font.semibold, fontSize: theme.type.label, textAlign: 'center' },
  labelOn: { color: colors.textPrimary, fontFamily: theme.font.bold },
  pressed: { opacity: 0.7 },
});
