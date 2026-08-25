import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { CloseButton } from '@/src/components/CloseButton';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { isOpponentOnly } from '@/src/lib/matchKind';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

const score = (value: string) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 && parsed <= 99 ? parsed : null; };

export default function MatchResultScreen() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['live-match', id], queryFn: () => api.live(id), enabled: Boolean(id), refetchInterval: false });
  const [home, setHome] = React.useState('');
  const [away, setAway] = React.useState('');
  React.useEffect(() => { if (query.data) { setHome(String(query.data.match.home_score)); setAway(String(query.data.match.away_score)); } }, [query.data]);
  const save = useMutation({ mutationFn: () => api.setMatchResult(id, score(home)!, score(away)!), onError: (error) => showMessage('Score not saved', (error as ApiError).message), onSuccess: async (match) => { client.setQueryData(['live-match', id], (current: typeof query.data) => current ? { ...current, match, revision: match.revision } : current); await invalidateAfterWrite(client, 'match'); showToast('Final score saved'); } });
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;
  return <Screen action={<CloseButton />} title="Match result">{query.isLoading ? <LoadingState label="Loading match" /> : query.isError || !query.data ? <ErrorState message={(query.error as ApiError)?.message ?? 'Match not found.'} onRetry={() => query.refetch()} /> : !isOpponentOnly(query.data.match) ? <ErrorState message="This match has an AIMZ squad in it. Score it from live scoring." onRetry={() => query.refetch()} /> : <View style={styles.card}><View style={styles.teams}><Text style={styles.team}>{query.data.match.home_team?.name}</Text><Text style={styles.vs}>vs</Text><Text style={[styles.team, styles.away]}>{query.data.match.away_team?.name}</Text></View><View style={styles.scores}><FormField containerStyle={styles.score} inputMode="numeric" keyboardType="number-pad" label="Home score" onChangeText={setHome} value={home} /><FormField containerStyle={styles.score} inputMode="numeric" keyboardType="number-pad" label="Away score" onChangeText={setAway} value={away} /></View><AppButton disabled={score(home) === null || score(away) === null || save.isPending} label={query.data.match.status === 'finished' ? 'Update final score' : 'Save final score'} onPress={() => confirmAction('Save final score?', 'Standings will update from this final score.', 'Save score', () => save.mutate())} /></View>}</Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ away: { textAlign: 'right' }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.spacing.lg }, score: { flex: 1 }, scores: { flexDirection: 'row', gap: theme.spacing.md }, team: { color: colors.textPrimary, flex: 1, fontSize: theme.type.body, fontWeight: '900' }, teams: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm }, vs: { color: colors.textMuted, fontWeight: '800' } });
