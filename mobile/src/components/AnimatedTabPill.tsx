import type { PropsWithChildren } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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

type FadeThroughProps = PropsWithChildren<{
  transitionKey: string | null | undefined;
  testID?: string;
}>;

function useReduceMotion() {
  // Start conservatively so a selection made before the async preference read
  // never flashes an animation at somebody who has asked not to see one.
  const [reduceMotion, setReduceMotion] = useState(true);

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

  return reduceMotion;
}

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

/**
 * Fades the old keyed content out, swaps it, then fades the new content in.
 * Live updates for the current key pass straight through without animating.
 */
export function FadeThrough({ children, testID, transitionKey }: FadeThroughProps) {
  const styles = useThemedStyles(stylesheet);
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const [displayed, setDisplayed] = useState(() => ({ children, key: transitionKey }));
  const latest = useRef({ children, key: transitionKey });
  const generation = useRef(0);
  /** The transition that has faded out but not yet reached its new content. */
  const midFade = useRef(0);
  latest.current = { children, key: transitionKey };

  useEffect(() => {
    if (displayed.key === transitionKey) {
      // The key came back to what is already on screen before the fade-out
      // finished, so no fade-in is coming to undo it. Left alone the content
      // keeps whatever opacity the stopped animation reached — near zero, if it
      // got far enough, which reads as an empty screen. Bumping the generation
      // orphans the fade-out's own callback so it cannot revive the transition.
      if (midFade.current) {
        midFade.current = 0;
        generation.current += 1;
        opacity.stopAnimation();
        opacity.setValue(1);
      }
      return undefined;
    }

    const currentGeneration = ++generation.current;
    midFade.current = currentGeneration;
    opacity.stopAnimation();

    if (reduceMotion) {
      midFade.current = 0;
      setDisplayed(latest.current);
      opacity.setValue(1);
      return undefined;
    }

    const fadeOut = Animated.timing(opacity, {
      duration: theme.motion.standard / 2,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    });
    let fadeIn: Animated.CompositeAnimation | undefined;

    fadeOut.start(({ finished }) => {
      if (!finished || generation.current !== currentGeneration) return;
      midFade.current = 0;
      setDisplayed(latest.current);
      opacity.setValue(0);
      fadeIn = Animated.timing(opacity, {
        duration: theme.motion.standard / 2,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      });
      fadeIn.start();
    });

    return () => {
      fadeOut.stop();
      fadeIn?.stop();
    };
  }, [displayed.key, opacity, reduceMotion, transitionKey]);

  const visibleChildren = displayed.key === transitionKey ? children : displayed.children;
  return <Animated.View style={[styles.fadeContent, { opacity }]} testID={testID}>{visibleChildren}</Animated.View>;
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
    fontWeight: '800',
    letterSpacing: -0.4,
    position: 'relative',
    textAlign: 'center',
    zIndex: 1,
  },
  labelCompact: { fontSize: theme.type.caption, lineHeight: theme.spacing.md },
  labelSelected: { color: colors.onAccent, fontWeight: '900' },
  pressed: { opacity: 0.7 },
  fadeContent: { gap: theme.spacing.lg },
});
