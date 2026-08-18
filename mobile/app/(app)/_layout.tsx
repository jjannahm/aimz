import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { theme } from '@/src/theme';

export default function AppLayout() {
  const { isReady, user } = useAuth();
  if (!isReady) return <View style={styles.loading}><ActivityIndicator color={theme.colors.accent} /></View>;
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
const styles = StyleSheet.create({ loading: { alignItems: 'center', backgroundColor: theme.colors.background, flex: 1, justifyContent: 'center' } });
