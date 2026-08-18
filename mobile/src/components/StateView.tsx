import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton } from '@/src/components/AppButton';
import { theme } from '@/src/theme';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <View accessibilityLiveRegion="polite" style={styles.box}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.body}>{label}</Text></View>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <View style={styles.box}><Ionicons color={theme.colors.textMuted} name="football-outline" size={32} /><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></View>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View accessibilityLiveRegion="assertive" style={styles.box}><Ionicons color={theme.colors.error} name="cloud-offline-outline" size={32} /><Text style={styles.title}>Could not load this</Text><Text style={styles.body}>{message}</Text><AppButton compact label="Try again" onPress={onRetry} variant="secondary" /></View>;
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.xl },
  title: { color: theme.colors.textPrimary, fontSize: theme.type.heading, fontWeight: '800', textAlign: 'center' },
  body: { color: theme.colors.textSecondary, fontSize: theme.type.body, lineHeight: 23, textAlign: 'center' },
});
