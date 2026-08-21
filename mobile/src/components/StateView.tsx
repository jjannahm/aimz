import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton } from '@/src/components/AppButton';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  return <View accessibilityLiveRegion="polite" style={styles.box}><ActivityIndicator color={colors.accent} /><Text style={styles.body}>{label}</Text></View>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.box}><Ionicons color={colors.textMuted} name="football-outline" size={32} /><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></View>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  return <View accessibilityLiveRegion="assertive" style={styles.box}><Ionicons color={colors.error} name="cloud-offline-outline" size={32} /><Text style={styles.title}>Could not load this</Text><Text style={styles.body}>{message}</Text><AppButton compact label="Try again" onPress={onRetry} variant="secondary" /></View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  box: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.xl },
  title: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: theme.type.body, lineHeight: 23, textAlign: 'center' },
});
