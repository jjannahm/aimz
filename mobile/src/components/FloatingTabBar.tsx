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

/**
 * What a page has to leave clear at its foot with the dock as low as it goes:
 * the rail, and the gap below it.
 */
const CLEARANCE = theme.touch.minimum + theme.spacing.sm * 2 + theme.spacing.xs * 2 + theme.spacing.lg;

/**
 * The same, once a home indicator has pushed the dock up the screen. The dock
 * rests on `max(inset, spacing.md)`, so every point the inset adds beyond that
 * gap lifts the rail by as much, and the page has to give the same back.
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
 * Every tab is the same size and stays that size, named under its own glyph.
 * What marks the open one is a rounded marker behind it, and that marker slides
 * from tab to tab rather than blinking across. Since the tabs share the rail
 * evenly, where the marker belongs is a matter of the index alone — no tab has
 * to report its own box for the marker to find it.
 */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [lane, setLane] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  // Routes the layout hid — settings, and whichever of Manage or Hub this role
  // does not have — never reach the dock.
  const routes = state.routes.filter((route) => !isHidden(descriptors[route.key]?.options.tabBarItemStyle));
  const activeIndex = routes.findIndex((route) => route.key === state.routes[state.index]?.key);
  const width = routes.length ? lane / routes.length : 0;

  useEffect(() => {
    if (activeIndex < 0) return undefined;
    // The first tab is marked outright; only a later one travels.
    if (!settled.current || reduceMotion) {
      slide.stopAnimation();
      slide.setValue(activeIndex);
      settled.current = true;
      return undefined;
    }
    const animation = Animated.spring(slide, { bounciness: 0, speed: 16, toValue: activeIndex, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [activeIndex, reduceMotion, slide]);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
      <View
        // The lane the marker travels is the rail inside its own padding, and
        // every tab takes an equal share of it.
        onLayout={(event) => setLane(event.nativeEvent.layout.width - theme.spacing.xs * 2)}
        style={styles.rail}
      >
        {width ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.marker, { transform: [{ translateX: Animated.multiply(slide, width) }], width }]}
          />
        ) : null}
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
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <TabIcon color={focused ? colors.onAccent : colors.textSecondary} name={icons[route.name] ?? 'matches'} size={22} />
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
  wrap: { alignItems: 'center', bottom: 0, left: 0, paddingHorizontal: theme.spacing.md, position: 'absolute', right: 0 },
  rail: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    elevation: 6,
    flexDirection: 'row',
    padding: theme.spacing.xs,
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    maxWidth: 760,
    width: '100%',
  },
  // Laid in the lane before the tabs are, so the tabs draw over it. It fills
  // the rail's height, which is what leaves it wrapping name as well as glyph.
  //
  // The accent is washed over the rail rather than replacing it, which is what
  // lets a tab keep one set of colours. A solid fill would need its glyph and
  // name inverted to read, and a tab's colours cannot travel with the marker —
  // they change the moment it is opened, while the marker takes the whole slide
  // to arrive, so the inverted pair would spend that time on bare rail. A wash
  // leaves the rail's own light and dark where they were, so both read wherever
  // the marker happens to be.
  //
  // A pill, not a rounded rectangle: inset evenly inside the rail's own pill it
  // sits exactly concentric with it, which is what lets the glow off the ends
  // rather than being clipped back to the rail.
  marker: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    bottom: theme.spacing.xs,
    left: theme.spacing.xs,
    position: 'absolute',
    top: theme.spacing.xs,
  },
  // An equal share of the rail each, and tall enough that the whole tab clears
  // the minimum target on its own.
  item: { ...noFocusRing, alignItems: 'center', flex: 1, gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingVertical: theme.spacing.sm },
  // `textSecondary`, not `textMuted`: whatever scrolls under the glass shows
  // through it, and a muted grey stops carrying against a bright page.
  label: { color: colors.textSecondary, fontFamily: theme.font.semibold, fontSize: theme.type.caption },
  labelOn: { color: colors.onAccent, fontFamily: theme.font.bold },
  pressed: { opacity: 0.7 },
});
