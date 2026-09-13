import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/src/components/BrandMark';
import { SeoHead } from '@/src/components/SeoHead';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export default function NotFoundScreen() {
  const styles = useThemedStyles(stylesheet);
  return <SafeAreaView style={styles.safe}>
    <SeoHead noIndex title="Page not found | AIMZ Egypt" description="The requested AIMZ Egypt page could not be found." path="404" />
    <View style={styles.content}>
      <BrandMark size={56} />
      <Text accessibilityRole="header" aria-level={1} style={styles.title}>Page not found</Text>
      <Text style={styles.body}>The link may be outdated or the address may have been entered incorrectly.</Text>
      <Link accessibilityRole="button" href="/" style={styles.action}>Go to AIMZ home</Link>
    </View>
  </SafeAreaView>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { alignItems: 'center', flex: 1, gap: theme.spacing.lg, justifyContent: 'center', padding: theme.size.phoneGutter },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.display, textAlign: 'center' },
  body: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 24, maxWidth: 440, textAlign: 'center' },
  action: { backgroundColor: colors.accent, borderRadius: theme.radius.md, color: colors.onAccent, fontFamily: theme.font.bold, fontSize: theme.type.body, minHeight: theme.touch.minimum, overflow: 'hidden', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, textAlign: 'center' },
});
