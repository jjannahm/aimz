import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { api } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The three lists every tab is built from. Fetched once the reader is in,
 * rather than when a tab is first opened: the tap itself is instant either way,
 * but waiting until then is what left the page on a spinner while the network
 * answered. Whichever tab is opened first now finds them already in hand.
 */
function useWarmLists(ready: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    void client.prefetchQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams('?limit=100') });
    void client.prefetchQuery({ queryKey: cacheKeys.players, queryFn: () => api.players('?limit=100') });
    void client.prefetchQuery({ queryKey: cacheKeys.competitions, queryFn: () => api.competitions('?limit=100') });
  }, [client, ready]);
}

export default function AppLayout() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { isReady, user } = useAuth();
  useWarmLists(isReady && Boolean(user));
  if (!isReady) return <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>;
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ loading: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center' } });
