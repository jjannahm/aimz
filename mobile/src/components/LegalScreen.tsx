import { Link, Stack } from 'expo-router';
import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/src/components/BrandMark';
import { SeoHead } from '@/src/components/SeoHead';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export const LEGAL_EFFECTIVE_DATE = '13 September 2026';

export function LegalScreen({ title, summary, children }: PropsWithChildren<{ title: string; summary: string }>) {
  const styles = useThemedStyles(stylesheet);
  return <SafeAreaView style={styles.safe}>
    <SeoHead title={`${title} | AIMZ Egypt`} description={summary} path={title === 'Privacy policy' ? 'privacy' : title === 'Cookie policy' ? 'cookies' : 'terms'} />
    <Stack.Screen options={{ title: `${title} | AIMZ Egypt` }} />
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.page}>
        <View style={styles.topbar}>
          <Link accessibilityLabel="Return to sign in" href="/(auth)/login" style={styles.back}>← Sign in</Link>
          <BrandMark size={40} />
        </View>
        <View style={styles.heading}>
          <Text accessibilityRole="header" aria-level={1} style={styles.title}>{title}</Text>
          <Text style={styles.updated}>Effective {LEGAL_EFFECTIVE_DATE}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <View style={styles.content}>{children}</View>
        <LegalFooter />
      </View>
    </ScrollView>
  </SafeAreaView>;
}

export function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.section}>
    <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>;
}

export function P({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(stylesheet);
  return <Text style={styles.body}>{children}</Text>;
}

export function Bullet({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.bulletRow}><Text accessibilityElementsHidden aria-hidden style={styles.bullet}>•</Text><Text style={styles.bulletText}>{children}</Text></View>;
}

export function InlineLegalLink({ href, children }: PropsWithChildren<{ href: '/privacy' | '/terms' | '/cookies' }>) {
  const styles = useThemedStyles(stylesheet);
  return <Link href={href as never} style={styles.link}>{children}</Link>;
}

export function LegalFooter() {
  const styles = useThemedStyles(stylesheet);
  return <View accessibilityLabel="Legal information" style={styles.footer}>
    <Link href={'/privacy' as never} style={styles.link}>Privacy policy</Link>
    <Link href={'/terms' as never} style={styles.link}>Terms and conditions</Link>
    <Link href={'/cookies' as never} style={styles.link}>Cookie policy</Link>
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  scroll: { alignItems: 'center', flexGrow: 1, padding: theme.size.phoneGutter },
  page: { gap: theme.spacing.xl, maxWidth: 760, width: '100%' },
  topbar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: theme.touch.minimum },
  back: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.body, paddingVertical: theme.spacing.md },
  heading: { gap: theme.spacing.sm },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.display, lineHeight: 36 },
  updated: { color: colors.textMuted, fontFamily: theme.font.medium, fontSize: theme.type.caption },
  summary: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 24 },
  content: { backgroundColor: colors.surface, borderRadius: theme.radius.lg, gap: theme.spacing.xl, padding: theme.spacing.xl },
  section: { gap: theme.spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading, lineHeight: 28 },
  body: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 25 },
  bulletRow: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.sm },
  bullet: { color: colors.accentSoft, fontSize: theme.type.body, lineHeight: 25 },
  bulletText: { color: colors.textSecondary, flex: 1, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 25 },
  link: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.label, minHeight: theme.touch.minimum, paddingVertical: theme.spacing.md },
  footer: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.lg, justifyContent: 'center' },
});
