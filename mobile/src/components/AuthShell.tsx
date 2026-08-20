import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/src/components/BrandMark';
import { ConnectionStatus } from '@/src/components/ConnectionStatus';
import { StagingNotice } from '@/src/components/StagingNotice';
import { appConfig } from '@/src/config';
import { theme } from '@/src/theme';

export function AuthShell({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            <View style={styles.brand}><BrandMark /></View>
            <StagingNotice />
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

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.colors.background, flex: 1 }, flex: { flex: 1 },
  scroll: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: theme.spacing.lg },
  column: { gap: theme.spacing.xl, maxWidth: 560, width: '100%' },
  brand: { alignItems: 'center' },
  card: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.spacing.lg },
  heading: { gap: theme.spacing.xs }, title: { color: theme.colors.textPrimary, fontSize: theme.type.display, fontWeight: '900' }, subtitle: { color: theme.colors.textSecondary, fontSize: theme.type.body, lineHeight: 23 },
});
