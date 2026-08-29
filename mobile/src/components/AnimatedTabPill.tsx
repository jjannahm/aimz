import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useReduceMotion } from '@/src/lib/useReduceMotion';
import { noFocusRing, theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type AnimatedTabPillProps = {
  accessibilityLabel?: string;
  compact?: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A standalone tab whose selected colour grows from the bottom edge.
 *
 * It deliberately does not replace SegmentedControl: these separate pills are
 * the navigation treatment used by Standings competitions and Manage only.
 */
export function AnimatedTabPill({
  accessibilityLabel,
  compact = false,
  label,
  onPress,
  selected,
  style,
  testID,
}: AnimatedTabPillProps) {
  const styles = useThemedStyles(stylesheet);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const previousSelected = useRef(selected);
  const previousReduceMotion = useRef(reduceMotion);

  useEffect(() => {
    const changed = previousSelected.current !== selected;
    const motionWasReduced = previousReduceMotion.current;
    previousSelected.current = selected;
    previousReduceMotion.current = reduceMotion;

    if (!changed) {
      // If reduced motion is enabled during a running transition, finish it
      // immediately. Resolving the initial preference needs no redundant write.
      if (reduceMotion && !motionWasReduced) {
        progress.stopAnimation();
        progress.setValue(selected ? 1 : 0);
      }
      return undefined;
    }

    progress.stopAnimation();

    if (reduceMotion) {
      progress.setValue(selected ? 1 : 0);
      return undefined;
    }

    const animation = Animated.timing(progress, {
      duration: theme.motion.standard,
      easing: selected ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      toValue: selected ? 1 : 0,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, selected]);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        selected && styles.pillSelected,
        style,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Animated.View
        accessible={false}
        pointerEvents="none"
        style={[styles.fill, { transform: [{ scaleY: progress }] }]}
        testID={testID ? `${testID}-fill` : undefined}
      />
      <Text
        numberOfLines={1}
        style={[styles.label, compact && styles.labelCompact, selected && styles.labelSelected]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  pill: {
    ...noFocusRing,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touch.minimum,
    overflow: 'hidden',
  },
  pillSelected: { borderColor: colors.accent },
  // The dock's accent, so a selected tab reads the same wherever it is.
  fill: {
    backgroundColor: colors.accent,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    transformOrigin: 'bottom',
  },
  label: {
    color: colors.textSecondary,
    fontSize: theme.type.body,
    fontFamily: theme.font.semibold,
    position: 'relative',
    textAlign: 'center',
    zIndex: 1,
  },
  labelCompact: { fontSize: theme.type.caption, lineHeight: theme.spacing.md },
  labelSelected: { color: colors.onAccent, fontFamily: theme.font.bold },
  pressed: { opacity: 0.7 },
});
