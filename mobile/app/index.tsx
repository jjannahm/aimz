import { Link, Redirect } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/src/auth/AuthProvider';
import { BrandMark } from '@/src/components/BrandMark';
import { LegalFooter } from '@/src/components/LegalScreen';
import { SeoHead } from '@/src/components/SeoHead';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

export default function Index() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { isReady, user } = useAuth();
  if (!isReady) return <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View>;
  if (!user) return <PublicHome />;
  // Somebody still waiting to be let in sees neither dock nor Hub.
  if (user.onboarding_status === 'pending') return <Redirect href={'/(app)/pending' as never} />;
  // A family opens on the Hub: their own week is what they came for. An
  // administrator and a coach have no Hub and land on the dock's anchor, which
  // is the Match Centre.
  const family = user.role !== 'admin' && user.role !== 'coach';
  return <Redirect href={(family ? '/(app)/(tabs)/my-team' : '/(app)/(tabs)') as never} />;
}

const faqs = [
  ['Who can create an account?', 'AIMZ accounts are invitation-only. Players, parents or guardians, coaches, and administrators use the invitation issued for their role.'],
  ['What can families see?', 'A linked family account can view the relevant player’s schedule, academy updates, attendance information, and available performance records.'],
  ['Is this the public staging site?', 'A staging build is a disposable preview and must use fictional player, family, and academy data only.'],
  ['How is personal information handled?', 'AIMZ limits access by role and explains collection, storage, rights, and current service providers in the Privacy Policy.'],
];

export function PublicHome() {
  const styles = useThemedStyles(stylesheet);
  return <SafeAreaView style={styles.safe}>
    <SeoHead title="AIMZ Egypt | Girls’ football scores and academy updates" description="Invitation-only access to AIMZ Egypt fixtures, results, team information, and academy operations." />
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.page}>
        <View style={styles.nav}><BrandMark size={52} /><Link href="/(auth)/login" style={styles.navLink}>Sign in</Link></View>
        <View style={styles.hero}>
          <Text accessibilityRole="header" aria-level={1} style={styles.title}>Your AIMZ season, in one place.</Text>
          <Text style={styles.lede}>View fixtures, results, team information, and academy updates through your private AIMZ account.</Text>
          <View style={styles.actions}>
            <Link accessibilityRole="button" href="/(auth)/login" style={[styles.cta, styles.primaryCta]}>Sign in to AIMZ</Link>
            <Link accessibilityRole="button" href="/(auth)/register" style={[styles.cta, styles.secondaryCta]}>Use an invite code</Link>
          </View>
        </View>
        <View style={styles.faq}>
          <Text accessibilityRole="header" aria-level={2} style={styles.faqHeading}>Frequently asked questions</Text>
          {faqs.map(([question, answer]) => <View key={question} style={styles.faqItem}>
            <Text accessibilityRole="header" aria-level={3} style={styles.question}>{question}</Text>
            <Text style={styles.answer}>{answer}</Text>
          </View>)}
        </View>
        <LegalFooter />
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  loading: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' },
  safe: { backgroundColor: colors.background, flex: 1 },
  scroll: { alignItems: 'center', flexGrow: 1, padding: theme.size.phoneGutter },
  page: { gap: theme.spacing.xxxl, maxWidth: 920, width: '100%' },
  nav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 60 },
  navLink: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.body, minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  hero: { gap: theme.spacing.xl, maxWidth: 720, paddingVertical: theme.spacing.xxxl },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: 48, letterSpacing: -1.2, lineHeight: 54 },
  lede: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: 20, lineHeight: 30, maxWidth: 620 },
  actions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  cta: { borderRadius: theme.radius.md, borderWidth: 1, fontFamily: theme.font.bold, fontSize: theme.type.body, minHeight: theme.touch.minimum, overflow: 'hidden', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, textAlign: 'center' },
  primaryCta: { backgroundColor: colors.accent, borderColor: colors.accent, color: colors.onAccent },
  secondaryCta: { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary },
  faq: { gap: theme.spacing.xl },
  faqHeading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.display, lineHeight: 36 },
  faqItem: { borderTopColor: colors.border, borderTopWidth: 1, gap: theme.spacing.sm, paddingTop: theme.spacing.lg },
  question: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading, lineHeight: 28 },
  answer: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 25, maxWidth: 720 },
});
