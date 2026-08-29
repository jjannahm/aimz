import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/src/components/BrandMark';
import { ConnectionStatus } from '@/src/components/ConnectionStatus';
import { appConfig } from '@/src/config';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export function AuthShell({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle: string }>) {
  const styles = useThemedStyles(stylesheet);
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            <View style={styles.brand}><BrandMark /></View>
            {appConfig.isStaging ? <ConnectionStatus /> : null}
            <View style={styles.card}>
              <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
              {children}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 }, flex: { flex: 1 },
  scroll: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: theme.size.phoneGutter },
  column: { gap: theme.spacing.lg, maxWidth: 520, width: '100%' },
  brand: { alignItems: 'center' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.size.cardPadding },
  heading: { gap: theme.spacing.xs }, title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.display }, subtitle: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 23 },
});
