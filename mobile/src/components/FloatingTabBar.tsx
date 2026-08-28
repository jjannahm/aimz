import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
/**
 * What frosts the rail. `backdrop-filter` is a web platform feature — blurring
 * what sits behind a native view takes a module this app does not carry — so the
 * rail is translucent only where there is a blur to back that up, and solid
 * elsewhere rather than see-through and muddled.
 */
const frosting = Platform.OS === 'web' ? ({ backdropFilter: 'blur(24px) saturate(180%)' } as ViewStyle) : null;

/**
 * What a page has to leave clear at its foot with the dock as low as it goes:
 * the rail, the gap below it, and the swell standing out of its top.
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
 *
 * The names take no part in it. Every chip keeps its own, on the dock's floor,
 * and the swell travels over the top of them.
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
      <View style={[styles.rail, frosting]}>
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
              <Text numberOfLines={1} style={[styles.label, focused && styles.labelOn]}>{label}</Text>
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
    backgroundColor: Platform.OS === 'web' ? colors.surfaceGlass : colors.surfaceRaised,
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
  // The chip's resting size is the smallest the target ever gets, so
  // magnification only ever makes one easier to hit. The name below sets the
  // width wherever it is the wider of the two.
  item: { ...noFocusRing, alignItems: 'center', gap: theme.spacing.xs, minWidth: CHIP },
  // `transformOrigin: 'bottom'` grows the chip up off its own name, so the swell
  // stands out of the rail and the names never budge.
  chip: { alignItems: 'center', backgroundColor: colors.background, borderRadius: theme.radius.pill, height: CHIP, justifyContent: 'center', transformOrigin: 'bottom', width: CHIP },
  chipOn: { backgroundColor: colors.accent },
  // `textSecondary`, not `textMuted`: whatever scrolls under the glass shows
  // through it, and a muted grey stops carrying against a bright page.
  label: { color: colors.textSecondary, fontSize: theme.type.caption, fontWeight: '700' },
  labelOn: { color: colors.textPrimary },
  pressed: { opacity: 0.7 },
});
