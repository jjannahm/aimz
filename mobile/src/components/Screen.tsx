import type { PropsWithChildren, ReactNode, RefObject } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/src/components/BrandMark';
import { useDockClearance } from '@/src/components/FloatingTabBar';
import { SettingsButton } from '@/src/components/SettingsButton';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = PropsWithChildren<{
  title: string;
  action?: ReactNode;
  scroll?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  /** Settings itself, which has nowhere to go. */
  hideSettings?: boolean;
}>;

export function Screen({ title, action, scroll = true, scrollRef, hideSettings = false, children }: Props) {
  const styles = useThemedStyles(stylesheet);
  const [headerHeight, setHeaderHeight] = useState(0);
  const clearance = useDockClearance();
  const content = (
    <View style={[styles.content, { paddingBottom: clearance }, scroll ? styles.growing : styles.filling]}>
      <View onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)} style={styles.header}>
        {/* The brand holds the top-left corner, ahead of the page's own title. */}
        <BrandMark size={30} />
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        </View>
        {/* Settings left the tab bar, so the header carries it on every screen.
         * It sits inside the same right-hand cluster as a screen's own action,
         * left of it, so a close button stays on the outside edge. */}
        <View style={styles.actions}>
          {hideSettings ? null : <SettingsButton />}
          {action}
        </View>
      </View>
      {children}
      {/* A page barely taller than the screen leaves the header stranded in
       * view, which reads as a header pinned there on purpose. This makes room
       * for it to scroll away on every screen, however little else there is. */}
      {scroll && headerHeight ? <View style={{ height: headerHeight }} /> : null}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* The scroller takes its height from the area it is given, never from the
       * window. Sizing it to the window let the software keyboard — which
       * shrinks the viewport out from under the app — leave the content cut off
       * short of the keyboard with a band of bare background between them.
       * `minHeight: 0` is what makes `flex: 1` hold: a flex child defaults to
       * `min-height: auto` and grows to its content, which is why capping the
       * height was reached for in the first place. */}
      {scroll ? <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" style={styles.scroller}>{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  scroller: { flex: 1, minHeight: 0 },
  scroll: { flexGrow: 1 },
  // The dock floats over the page rather than taking a strip below it, so the
  // last of the content has to clear where it sits, name included. How much
  // that is depends on the inset, so `useDockClearance` sets it per screen.
  content: { alignSelf: 'center', gap: theme.spacing.lg, maxWidth: 760, padding: theme.spacing.lg, width: '100%' },
  growing: { flexGrow: 1 },
  filling: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  actions: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: theme.spacing.xs },
  heading: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: theme.type.display, fontWeight: '900', letterSpacing: -0.7 },
});
