import type { PropsWithChildren, ReactNode, RefObject } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = PropsWithChildren<{ title: string; eyebrow?: string; action?: ReactNode; scroll?: boolean; scrollRef?: RefObject<ScrollView | null> }>;

export function Screen({ title, eyebrow, action, scroll = true, scrollRef, children }: Props) {
  const styles = useThemedStyles(stylesheet);
  const content = (
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={styles.heading}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        </View>
        {action}
      </View>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  scroll: { flexGrow: 1 },
  content: { alignSelf: 'center', flex: 1, gap: theme.spacing.lg, maxWidth: 760, padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, width: '100%' },
  header: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  heading: { flex: 1 },
  eyebrow: { color: colors.accentSoft, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.textPrimary, fontSize: theme.type.display, fontWeight: '900', letterSpacing: -0.7 },
});
