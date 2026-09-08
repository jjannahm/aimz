import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage, showToast } from '@/src/lib/platformAlert';
import { parseTrainingSheet, readyReadings, sheetTemplate, type ParsedSheet } from '@/src/lib/trainingImport';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Team, TrainingMetric } from '@/src/types/api';

const WAYS = [{ label: 'By hand', value: 'hand' }, { label: 'From a sheet', value: 'sheet' }] as const;
type Way = (typeof WAYS)[number]['value'];

/** What a metric asks for, said under its field. */
const askFor = (metric: TrainingMetric) =>
  metric.kind === 'rating' ? `${metric.min_value ?? 0} to ${metric.max_value ?? 10}` : metric.unit ?? 'A number';

/**
 * Recording how a squad trained.
 *
 * A squad first, then the session, because a reading belongs to one session and
 * choosing it later would mean holding a page of numbers with nowhere to put
 * them. Then either way of getting them in: typed at the row, or read out of a
 * sheet somebody already keeps.
 */
export function TrainingStatsManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [teamId, setTeamId] = React.useState('');
  const [sessionId, setSessionId] = React.useState('');
  const [way, setWay] = React.useState<Way>('hand');

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
      <SegmentedControl label="How to record" onChange={setWay} options={WAYS} value={way} />
      {performance.isLoading ? <LoadingState label="Loading the squad" />
        : performance.isError ? <ErrorState message={(performance.error as ApiError).message} onRetry={() => performance.refetch()} />
          : way === 'hand'
            ? <ByHand
              items={performance.data?.items ?? []}
              metrics={performance.data?.metrics ?? []}
              onSaved={() => invalidateAfterWrite(client, 'training-stat')}
              sessionId={sessionId}
            />
            : <FromSheet
              metrics={performance.data?.metrics ?? []}
              onSaved={() => invalidateAfterWrite(client, 'training-stat')}
              players={(performance.data?.items ?? []).map((item) => item.player)}
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
      <AppButton compact disabled={!changed} label="Save" loading={saving === item.player.id} onPress={() => void save(item.player.id)} variant="secondary" />
    </View>;
  })}</View>;
}

/** A sheet pasted or picked from disk, read back before anything is sent. */
function FromSheet({ sessionId, metrics, players, onSaved }: {
  sessionId: string;
  metrics: TrainingMetric[];
  players: { id: string; name: string }[];
  onSaved: () => Promise<unknown>;
}) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const [text, setText] = React.useState('');
  const sheet: ParsedSheet | null = React.useMemo(
    () => (text.trim() ? parseTrainingSheet(text, metrics, players as never) : null),
    [text, metrics, players],
  );
  const ready = sheet ? readyReadings(sheet) : [];
  const broken = sheet?.rows.filter((row) => row.problem) ?? [];

  const send = useMutation({
    mutationFn: () => api.setTrainingPerformance(sessionId, ready),
    onError: (error) => showMessage('Not recorded', (error as ApiError).message),
    onSuccess: async () => { await onSaved(); setText(''); showToast(`Recorded ${ready.length} ${ready.length === 1 ? 'reading' : 'readings'}`); },
  });

  /**
   * Reading a file off disk, on the web build where an administrator sits.
   * No document-picker module is installed, and a paste covers a phone, so this
   * is offered where it works rather than everywhere it might.
   */
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setText(String(reader.result ?? ''));
      reader.onerror = () => showMessage('Could not read the file', 'Save it from Excel as CSV and try again.');
      reader.readAsText(file);
    };
    input.click();
  };

  return <View style={styles.sheet}>
    <Text style={styles.note}>
      One row per player. The first column is the player’s name, then a column for each metric. Save from Excel as CSV, or copy the cells and paste them.
    </Text>
    <View style={styles.template}>
      <Text style={styles.templateLabel}>Headings</Text>
      <Text selectable style={styles.templateRow}>{sheetTemplate(metrics)}</Text>
    </View>
    {Platform.OS === 'web' ? <AppButton compact icon="document-outline" label="Choose a CSV file" onPress={pick} variant="secondary" /> : null}
    <TextInput
      accessibilityLabel="Paste the sheet"
      multiline
      onChangeText={setText}
      placeholder={`Player,${metrics.map((metric) => metric.label).join(',')}\nAmina Adel,90,7,6,8`}
      placeholderTextColor={colors.textMuted}
      style={styles.paste}
      value={text}
    />

    {sheet?.problem ? <Text style={styles.bad}>{sheet.problem}</Text> : null}
    {sheet && !sheet.problem ? <View style={styles.preview}>
      <Text style={styles.previewTitle}>{ready.length} {ready.length === 1 ? 'reading' : 'readings'} ready{broken.length ? `, ${broken.length} ${broken.length === 1 ? 'row' : 'rows'} to fix` : ''}</Text>
      {/* Every row is shown back before anything is sent: the API takes the
        * batch or none of it, and a refusal afterwards says very little about
        * which of thirty rows was wrong. */}
      {sheet.rows.map((row) => <Text key={row.line} style={[styles.row, row.problem && styles.bad]}>
        {row.line}. {row.name || '—'}{row.problem ? ` · ${row.problem}` : ` · ${row.readings.filter((reading) => reading.value !== null).map((reading) => `${reading.metric.label} ${reading.value}`).join(', ')}`}
      </Text>)}
    </View> : null}

    <AppButton disabled={!ready.length} label={`Record ${ready.length || ''} ${ready.length === 1 ? 'reading' : 'readings'}`.replace('  ', ' ')} loading={send.isPending} onPress={() => send.mutate()} />
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
  list: { gap: theme.spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  name: { color: colors.textPrimary, fontFamily: theme.font.bold },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  field: { flexBasis: '47%', flexGrow: 1, minWidth: 0 },

  sheet: { gap: theme.spacing.sm },
  note: { color: colors.textMuted, fontSize: theme.type.label, lineHeight: 20 },
  template: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.sm, borderWidth: 1, gap: 2, padding: theme.spacing.sm },
  templateLabel: { color: colors.textMuted, fontSize: theme.type.caption },
  templateRow: { color: colors.accentSoft, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  paste: {
    backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1,
    color: colors.textPrimary, fontFamily: theme.font.mono, fontSize: theme.type.label, minHeight: 120,
    padding: theme.spacing.md, textAlignVertical: 'top',
  },
  preview: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 2, padding: theme.spacing.md },
  previewTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold, marginBottom: 2 },
  row: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  bad: { color: colors.errorText },
  empty: { color: colors.textMuted },
});
