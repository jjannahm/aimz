import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * Whether a player is on the app yet.
 *
 * Nothing records an install, so the nearest true thing is asked instead: has
 * anybody registered against this player — their own login, or a parent who
 * has them as a child. Either way somebody in that family has the app open.
 *
 * The accounts list is an administrator's route, so `enabled` is where the
 * caller says both that it wants the answer and that it is allowed to ask.
 * `known` is separate from the set on purpose: an empty set while the request
 * is still out means "nobody has an account", which is a different claim from
 * "we have not been told yet", and a row must not print the first while the
 * second is true.
 */
export function useOnTheApp(enabled: boolean) {
  const accounts = useQuery({ queryKey: cacheKeys.accounts, queryFn: () => api.adminUsers(), enabled });
  return useMemo(() => {
    const ids = new Set<string>();
    for (const account of accounts.data?.items ?? []) {
      if (account.player) ids.add(account.player.id);
      for (const child of account.children ?? []) ids.add(child.id);
    }
    return { ids, known: enabled && !accounts.isLoading && !accounts.isError };
  }, [accounts.data, accounts.isError, accounts.isLoading, enabled]);
}

/** Green once somebody has registered against the player, red until then. */
export function AppStatus({ on }: { on: boolean }) {
  const styles = useThemedStyles(stylesheet);
  return <View accessibilityLabel={on ? 'Has the app' : 'Has not downloaded the app'} accessibilityRole="text" style={styles.appStatus}>
    <View style={[styles.appDot, on ? styles.appDotOn : styles.appDotOff]} />
    <Text style={[styles.appStatusText, on ? styles.appStatusOn : styles.appStatusOff]}>{on ? 'On the app' : 'No app'}</Text>
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  appStatus: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs, marginTop: 4 },
  appDot: { borderRadius: 4, height: 8, width: 8 },
  appDotOn: { backgroundColor: colors.live },
  appDotOff: { backgroundColor: colors.error },
  appStatusText: { fontSize: theme.type.caption },
  appStatusOn: { color: colors.liveText },
  appStatusOff: { color: colors.errorText },
});
