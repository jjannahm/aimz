import type { PropsWithChildren, ReactNode, RefObject } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/src/components/BrandMark';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = PropsWithChildren<{ title: string; action?: ReactNode; scroll?: boolean; scrollRef?: RefObject<ScrollView | null> }>;

export function Screen({ title, action, scroll = true, scrollRef, children }: Props) {
  const styles = useThemedStyles(stylesheet);
  const { height } = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(0);
  const content = (
    <View style={[styles.content, scroll ? styles.growing : styles.filling]}>
      <View onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)} style={styles.header}>
        {/* The brand holds the top-left corner, ahead of the page's own title. */}
        <BrandMark size={30} />
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        </View>
        {action}
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
      {scroll ? <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" style={{ maxHeight: height }}>{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  scroll: { flexGrow: 1 },
  content: { alignSelf: 'center', gap: theme.spacing.lg, maxWidth: 760, padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, width: '100%' },
  growing: { flexGrow: 1 },
  filling: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  heading: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: theme.type.display, fontWeight: '900', letterSpacing: -0.7 },
});
