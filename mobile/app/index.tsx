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
  if (!user) return <Redirect href="/(auth)/login" />;
  // A family opens on the Hub: their own week is what they came for. An
  // administrator and a manager have no Hub and land on the dock's anchor,
  // which is the Match Centre.
  const family = user.role !== 'admin' && user.role !== 'manager';
  return <Redirect href={family ? '/(app)/(tabs)/my-team' : '/(app)/(tabs)'} />;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ loading: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' } });
