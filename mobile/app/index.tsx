import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { theme } from '@/src/theme';

export default function Index() {
  const { isReady, user } = useAuth();
  if (!isReady) return <View style={styles.loading}><ActivityIndicator color={theme.colors.accent} size="large" /></View>;
  return <Redirect href={user ? '/(app)/(tabs)' : '/(auth)/login'} />;
}

const styles = StyleSheet.create({ loading: { alignItems: 'center', backgroundColor: theme.colors.background, flex: 1, justifyContent: 'center' } });
