import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { appConfig } from '@/src/config';
import { api } from '@/src/lib/api';
import { theme } from '@/src/theme';

type ConnectionState = 'checking' | 'waking' | 'connected' | 'unreachable';

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>('checking');

  const checkConnection = useCallback(async () => {
    setState('checking');
    try {
      await api.waitUntilReady(() => setState('waking'));
      setState('connected');
    } catch {
      setState('unreachable');
    }
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const connected = state === 'connected';
  const checking = state === 'checking';
  const waking = state === 'waking';
  const waiting = checking || waking;
  const label = checking
    ? 'Checking preview server'
    : waking
      ? 'Preview server is waking up'
      : connected
        ? 'Preview server ready'
        : 'Preview server unavailable';

  return (
    <Pressable
      accessibilityHint="Checks the connection again"
      accessibilityLabel={`${label}. Server ${appConfig.apiBaseUrl}`}
      accessibilityRole="button"
      disabled={waiting}
      onPress={() => void checkConnection()}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {waiting ? <ActivityIndicator color={theme.colors.warning} size="small" /> : <View
        style={[styles.dot, connected && styles.dotConnected, state === 'unreachable' && styles.dotError]}
      />}
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={styles.detail}>
          {waking ? 'Free hosting can take up to a minute to restart.' : appConfig.apiBaseUrl}
        </Text>
      </View>
      <Text style={styles.action}>{waiting ? 'WAIT' : connected ? 'READY' : 'RETRY'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: theme.spacing.md,
  },
  pressed: { opacity: 0.78 },
  dot: {
    backgroundColor: theme.colors.warning,
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  dotConnected: { backgroundColor: theme.colors.live },
  dotError: { backgroundColor: theme.colors.error },
  copy: {
    flex: 1,
    marginHorizontal: theme.spacing.md,
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.label,
    fontWeight: '800',
  },
  detail: {
    color: theme.colors.textMuted,
    fontSize: theme.type.caption,
    marginTop: 3,
  },
  action: {
    color: theme.colors.lightBlue,
    fontSize: theme.type.caption,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});
