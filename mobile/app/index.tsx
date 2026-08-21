import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

export default function Index() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { isReady, user } = useAuth();
  if (!isReady) return <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View>;
  return <Redirect href={user ? '/(app)/(tabs)' : '/(auth)/login'} />;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ loading: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' } });
