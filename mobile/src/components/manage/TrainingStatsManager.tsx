import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Team, TrainingMetric } from '@/src/types/api';

/** What a metric asks for, said under its field. */
const askFor = (metric: TrainingMetric) =>
  metric.kind === 'rating' ? `${metric.min_value ?? 0} to ${metric.max_value ?? 10}` : metric.unit ?? 'A number';

/**
 * Recording how a squad trained.
 *
 * A squad first, then the session, because a reading belongs to one session and
 * choosing it later would mean holding a page of numbers with nowhere to put
 * them. Then the readings themselves, typed at the row.
 */
export function TrainingStatsManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [teamId, setTeamId] = React.useState('');
  const [sessionId, setSessionId] = React.useState('');

  const sessions = useQuery({
    queryKey: [...cacheKeys.training, 'team', teamId],
    queryFn: () => api.trainingSessions(`?team_id=${encodeURIComponent(teamId)}&limit=100`),
    enabled: Boolean(teamId),
  });
  const performance = useQuery({
    queryKey: [...cacheKeys.trainingStats, 'session', sessionId],
    queryFn: () => api.trainingPerformance(sessionId),
    enabled: Boolean(sessionId),
  });

  // A squad's sessions, newest first: a coach records the one just finished.
  const options = React.useMemo(() => [...(sessions.data?.items ?? [])]
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .map((session) => ({ label: `${formatEgyptDateTime(session.starts_at)} · ${session.venue}`, value: session.id })), [sessions.data]);

  const chooseTeam = (next: string) => { setTeamId(next); setSessionId(''); };

  if (!teams.length) return <Text style={styles.empty}>Add a squad before recording training.</Text>;

  return <View style={styles.stack}>
    <ChoiceField label="Squad" onChange={chooseTeam} options={teams.map((team) => ({ label: team.name, value: team.id }))} placeholder="Choose a squad" value={teamId} />

    {!teamId ? <Text style={styles.empty}>Choose a squad to record its training.</Text>
      : sessions.isLoading ? <LoadingState />
        : !options.length ? <Text style={styles.empty}>This squad has no training sessions yet. Add one under Schedule.</Text>
          : <ChoiceField label="Session" onChange={setSessionId} options={options} placeholder="Choose a session" value={sessionId} />}

    {sessionId ? <>
      {performance.isLoading ? <LoadingState label="Loading the squad" />
        : performance.isError ? <ErrorState message={(performance.error as ApiError).message} onRetry={() => performance.refetch()} />
          : <ByHand
            items={performance.data?.items ?? []}
            metrics={performance.data?.metrics ?? []}
            onSaved={() => invalidateAfterWrite(client, 'training-stat')}
            sessionId={sessionId}
          />}
    </> : null}
  </View>;
}

/** A field per metric, per player, saved a row at a time. */
function ByHand({ sessionId, metrics, items, onSaved }: {
  sessionId: string;
  metrics: TrainingMetric[];
  items: { player: { id: string; name: string }; values: Record<string, number> }[];
  onSaved: () => Promise<unknown>;
}) {
  const styles = useThemedStyles(stylesheet);
  // What has been typed but not yet sent, by player then metric.
  const [draft, setDraft] = React.useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = React.useState<string | null>(null);

  const save = async (playerId: string) => {
    const typed = draft[playerId] ?? {};
    const entries = metrics.map((metric) => {
      const raw = typed[metric.id];
      // Untouched fields are left alone; a field cleared to nothing removes the
      // reading, because for a mark out of ten a blank is not a nought.
      if (raw === undefined) return null;
      if (raw.trim() === '') return { player_id: playerId, metric_id: metric.id, value: null };
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${metric.label} is not a number.`);
      return { player_id: playerId, metric_id: metric.id, value };
    }).filter((entry): entry is { player_id: string; metric_id: string; value: number | null } => entry !== null);
    if (!entries.length) return;
    setSaving(playerId);
    try {
      await api.setTrainingPerformance(sessionId, entries);
      await onSaved();
      setDraft((current) => ({ ...current, [playerId]: {} }));
      showToast('Training recorded');
    } catch (error) {
      showMessage('Not recorded', (error as ApiError).message);
    } finally {
      setSaving(null);
    }
  };

  if (!items.length) return <Text style={styles.empty}>This squad has no players on it yet.</Text>;

  return <View style={styles.list}>{items.map((item) => {
    const typed = draft[item.player.id] ?? {};
    const changed = Object.keys(typed).length > 0;
    return <View key={item.player.id} style={styles.card}>
      <Text style={styles.name}>{item.player.name}</Text>
      <View style={styles.fields}>{metrics.map((metric) => <View key={metric.id} style={styles.field}>
        <FormField
          hint={askFor(metric)}
          inputMode="decimal"
          keyboardType="decimal-pad"
          label={metric.label}
          onChangeText={(text) => setDraft((current) => ({ ...current, [item.player.id]: { ...(current[item.player.id] ?? {}), [metric.id]: text } }))}
          placeholder={item.values[metric.id] === undefined ? '—' : String(item.values[metric.id])}
          value={typed[metric.id] ?? ''}
        />
      </View>)}</View>
      <AppButton compact disabled={!changed} label="Save" loading={saving === item.player.id} onPress={() => void save(item.player.id)} />
    </View>;
  })}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
  list: { gap: theme.spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  name: { color: colors.textPrimary, fontFamily: theme.font.bold },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  field: { flexBasis: '47%', flexGrow: 1, minWidth: 0 },
  empty: { color: colors.textMuted },
});
