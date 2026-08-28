import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutRectangle, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabIcon, type TabIconName } from '@/src/components/TabIcon';
import { theme, type ThemeColors } from '@/src/theme';
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
 * The bar that floats over the page rather than sitting in a strip below it.
 *
 * Only the current tab carries its label, so the tabs are different widths and
 * the pill cannot be sized from a fraction of the bar. Each tab reports its own
 * box as it lays out, and the pill is animated onto whichever is selected.
 */
export function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [boxes, setBoxes] = useState<Record<number, LayoutRectangle>>({});
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  // Routes the layout hid — settings, and whichever of Manage or Hub this role
  // does not have — never reach the bar.
  const routes = state.routes.filter((route) => !isHidden(descriptors[route.key]?.options.tabBarItemStyle));
  const activeIndex = routes.findIndex((route) => route.key === state.routes[state.index]?.key);
  const box = boxes[activeIndex];

  useEffect(() => {
    if (!box) return;
    // The first measurement places the pill outright; a tab change slides it.
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
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
      <View style={styles.bar}>
        {box ? <Animated.View style={[styles.pill, { left, width }]} /> : null}
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
              onLayout={(event) => {
                const next = event.nativeEvent.layout;
                setBoxes((current) => current[index]?.width === next.width && current[index]?.x === next.x ? current : { ...current, [index]: next });
              }}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={({ pressed }) => [styles.tab, focused && styles.tabOn, pressed && styles.pressed]}
            >
              <TabIcon color={focused ? colors.onAccent : colors.textMuted} name={icons[route.name] ?? 'matches'} size={22} />
              {/* The label belongs to the selected tab alone, which is what
                * leaves the rest of the bar to the glyphs. */}
              {focused ? <Text numberOfLines={1} style={styles.label}>{label}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // Over the page, not below it: the bar is laid on top and the scrollers keep
  // their own bottom padding clear of it.
  wrap: { bottom: 0, left: 0, paddingHorizontal: theme.spacing.md, position: 'absolute', right: 0 },
  bar: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    elevation: 12,
    flexDirection: 'row',
    maxWidth: 520,
    padding: theme.spacing.xs,
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    width: '100%',
  },
  pill: { backgroundColor: colors.accent, borderRadius: theme.radius.pill, bottom: theme.spacing.xs, position: 'absolute', top: theme.spacing.xs },
  tab: { alignItems: 'center', borderRadius: theme.radius.pill, flexDirection: 'row', flexGrow: 1, gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  // The selected tab keeps its label, so it asks for the room the pill fills.
  tabOn: { flexGrow: 0, paddingHorizontal: theme.spacing.md },
  label: { color: colors.onAccent, fontWeight: '900' },
  pressed: { opacity: 0.7 },
});
