import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PublicHome } from '@/app/index';
import { useAuth } from '@/src/auth/AuthProvider';
import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

export default function WelcomeScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { isReady, user } = useAuth();
  if (!isReady) return <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View>;
  if (user) return <Redirect href={'/(app)/(tabs)' as never} />;
  return <PublicHome />;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ loading: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' } });
