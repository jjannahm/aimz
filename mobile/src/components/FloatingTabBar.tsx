import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabIcon, type TabIconName } from '@/src/components/TabIcon';
import { useReduceMotion } from '@/src/lib/useReduceMotion';
import { noFocusRing, theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * What the tab navigator hands its bar. Described here rather than imported:
 * `@react-navigation/bottom-tabs` is expo-router's own dependency, not one of
 * ours. `href` is not among the options: expo-router takes it off and leaves a
 * hidden item style in its place, which is what {@link isHidden} reads.
 */
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; tabBarItemStyle?: StyleProp<ViewStyle> } }>;
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

/**
 * Whether the layout hid this route. `href: null` never reaches a bar of our
 * own: expo-router strips `href` from the options and marks the item
 * `display: 'none'` instead, so that is the flag to read.
 */
const isHidden = (style: StyleProp<ViewStyle>): boolean => StyleSheet.flatten(style)?.display === 'none';

/** Which glyph a route wears, keyed by the route's own name. */
const icons: Record<string, TabIconName> = {
  index: 'matches',
  standings: 'standings',
  players: 'players',
  'my-team': 'myTeam',
  manage: 'manage',
};

/** A chip at rest. Its resting size is the smallest target worth offering. */
const CHIP = theme.touch.minimum;
/** How far the chip under the focus swells, as a multiple of its resting size. */
const MAGNIFY = 1.4;
/** How many chips away from the focus the swell still reaches. */
const FALLOFF = 1.7;
/** How far a swollen chip overshoots the rail, which its name has to clear. */
const SWELL = Math.round(CHIP * (MAGNIFY - 1));

/**
 * What a page has to leave clear at its foot with the dock as low as it goes:
 * the rail, the gap below it, and room for the name floating above whichever
 * chip is swollen.
 */
const CLEARANCE = theme.spacing.xxxl + theme.spacing.xxl;

/**
 * The same, once a home indicator has pushed the dock up the screen. The dock
 * rests on `max(inset, spacing.md)`, so every point the inset adds beyond that
 * gap lifts the name by as much, and the page has to give the same back.
 *
 * Read off the context rather than through `useSafeAreaInsets`, which insists
 * on a provider. A page rendered without one has no indicator to clear either,
 * so the plain clearance is the right answer, not an error.
 */
export function useDockClearance() {
  const insets = useContext(SafeAreaInsetsContext);
  return CLEARANCE + Math.max((insets?.bottom ?? 0) - theme.spacing.md, 0);
}

/**
 * The dock that floats over the page rather than sitting in a strip below it.
 *
 * A single value holds the focus, and every chip reads its own size off it: a
 * chip is full size at the focus, back to resting {@link FALLOFF} chips away,
 * and somewhere between at the fractions the spring passes through on its way.
 * That is what carries the swell along the dock rather than teleporting it.
 */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const centre = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  // Routes the layout hid — settings, and whichever of Manage or Hub this role
  // does not have — never reach the dock.
  const routes = state.routes.filter((route) => !isHidden(descriptors[route.key]?.options.tabBarItemStyle));
  const activeIndex = routes.findIndex((route) => route.key === state.routes[state.index]?.key);
  // A pointer takes the focus while it is over the dock; otherwise the selected
  // tab holds it. `onHoverIn` never fires on a touchscreen, so on a phone the
  // focus is the selection and nothing else.
  const focusIndex = hovered !== null && hovered < routes.length ? hovered : activeIndex;

  useEffect(() => {
    if (focusIndex < 0) return undefined;
    // The first focus is placed outright; only a later one travels.
    if (!settled.current || reduceMotion) {
      centre.stopAnimation();
      centre.setValue(focusIndex);
      settled.current = true;
      return undefined;
    }
    const animation = Animated.spring(centre, { bounciness: 0, speed: 16, toValue: focusIndex, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [centre, focusIndex, reduceMotion]);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
      <View style={styles.rail}>
        {routes.map((route, index) => {
          const { options } = descriptors[route.key]!;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const focused = index === activeIndex;
          return (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onHoverIn={() => setHovered(index)}
              onHoverOut={() => setHovered((current) => (current === index ? null : current))}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <Animated.View
                style={[
                  styles.chip,
                  focused && styles.chipOn,
                  { transform: [{ scale: centre.interpolate({ inputRange: [index - FALLOFF, index, index + FALLOFF], outputRange: [1, MAGNIFY, 1], extrapolate: 'clamp' }) }] },
                ]}
              >
                <TabIcon color={focused ? colors.onAccent : colors.textMuted} name={icons[route.name] ?? 'matches'} size={22} />
              </Animated.View>
              {/* The dock names one chip at a time, the one the focus is on, and
                * fades that name in as the swell arrives under it. */}
              {index === focusIndex ? (
                <Animated.View
                  pointerEvents="none"
                  style={[styles.name, { opacity: centre.interpolate({ inputRange: [index - 0.5, index, index + 0.5], outputRange: [0, 1, 0], extrapolate: 'clamp' }) }]}
                >
                  <Text numberOfLines={1} style={styles.label}>{label}</Text>
                </Animated.View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // Over the page, not below it: the dock is laid on top and the scrollers keep
  // their own bottom padding clear of it.
  wrap: { bottom: 0, left: 0, paddingHorizontal: theme.spacing.md, position: 'absolute', right: 0 },
  // The rail takes only the room its chips need. `flex-end` sits them on its
  // floor, which is what lets a swollen one grow up and out of the top.
  rail: {
    alignItems: 'flex-end',
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    elevation: 12,
    flexDirection: 'row',
    // Wide enough apart that a swollen chip clears its neighbour, and inset far
    // enough that the swell at either end stays inside the rail's rounded cap.
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  // The press target keeps its resting size however far the chip swells, so
  // magnification only ever makes a target easier to hit.
  item: { ...noFocusRing, alignItems: 'center', height: CHIP, justifyContent: 'center', width: CHIP },
  chip: { alignItems: 'center', backgroundColor: colors.background, borderRadius: theme.radius.pill, height: CHIP, justifyContent: 'center', transformOrigin: 'bottom', width: CHIP },
  chipOn: { backgroundColor: colors.accent },
  // Cleared of the swell, and free to be wider than the chip it names.
  name: { alignItems: 'center', bottom: CHIP + SWELL + theme.spacing.xs, left: -theme.spacing.xxxl, position: 'absolute', right: -theme.spacing.xxxl, zIndex: 1 },
  label: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: theme.type.caption,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  pressed: { opacity: 0.7 },
});
