import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { HubGlass } from '@/src/components/myTeam/HubGlass';
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
 * The hub's own switcher: a glass capsule with a lens sliding under whichever
 * section is open.
 *
 * Its own rather than the shared control because only the hub is glass — the
 * rest of the app keeps flat surfaces, and one component cannot be both. The
 * lens takes an equal share of the capsule, so where it belongs is a matter of
 * the index and no tab has to report its own box.
 */
export function HubSwitcher<Value extends string>({ options, value, onChange, label }: Props<Value>) {
  const styles = useThemedStyles(stylesheet);
  const reduceMotion = useReduceMotion();
  const slide = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!settled.current || reduceMotion) {
      slide.stopAnimation();
      slide.setValue(index);
      settled.current = true;
      return undefined;
    }
    const animation = Animated.spring(slide, { bounciness: 0, speed: 14, toValue: index, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [index, reduceMotion, slide]);

  const share = 100 / options.length;
  return (
    <HubGlass intensity={45} radius={999} style={styles.capsule}>
      <View accessibilityLabel={label} accessibilityRole="tablist" style={styles.track}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.lens,
            // A share of the track wide, moved by whole shares. Translating a
            // percentage of its own width is what keeps this on the native
            // driver, where a left offset could not go.
            { width: `${share}%`, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }] },
          ]}
        />
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={[styles.label, selected && styles.labelOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </HubGlass>
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
  tab: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  labelOn: { color: colors.textPrimary, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
