import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { Screen } from '@/src/components/Screen';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export default function PendingApprovalScreen() {
  const styles = useThemedStyles(stylesheet);
  const { user, refreshUser, signOut, deleteAccount } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { await refreshUser(); } finally { setRefreshing(false); }
  };
  useEffect(() => {
    const timer = setInterval(() => { void refreshUser(); }, 15_000);
    return () => clearInterval(timer);
  }, [refreshUser]);
  useEffect(() => {
    if (user?.onboarding_status === 'approved') router.replace('/(app)/(tabs)');
  }, [user?.onboarding_status]);
  return <Screen hideSettings title="Application received">
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>AIMZ is reviewing your application</Text>
      <Text style={styles.copy}>You can keep this screen open. We check automatically and will unlock your account as soon as an administrator confirms your squad.</Text>
      <AppButton label="Check approval now" loading={refreshing} onPress={refresh} />
      <AppButton label="Sign out" onPress={signOut} variant="ghost" />
      <AppButton label="Delete account and application data" onPress={deleteAccount} variant="danger" />
    </View>
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  copy: { color: colors.textSecondary, fontFamily: theme.font.regular, lineHeight: 23 },
});
