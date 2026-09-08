import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { CollapsibleSection } from '@/src/components/CollapsibleSection';
import { FormField } from '@/src/components/FormField';
import { PlayerPickerField } from '@/src/components/PlayerPickerField';
import { ReportCard } from '@/src/components/ReportCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { confirmManageWrite } from '@/src/lib/manageToasts';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { reportShareUrl, shareReport } from '@/src/lib/reportLink';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { PlayerReport, Team } from '@/src/types/api';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const monthsAgo = (count: number) => { const date = new Date(); date.setUTCMonth(date.getUTCMonth() - count); return iso(date); };

/**
 * Writing a report and handing it to a family.
 *
 * The numbers are the academy's own records — attendance, matches and fees —
 * gathered for the period. The only part anybody writes is the feedback, and
 * the only decision is when to publish, because publishing is what freezes the
 * figures and mints the address the family is given.
 */
export function ReportsManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const client = useQueryClient();
  const [teamId, setTeamId] = React.useState(teams[0]?.id ?? '');
  const [formOpen, setFormOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ playerIds: [] as string[], title: '', start: monthsAgo(3), end: iso(new Date()), feedback: '' });

  const players = useQuery({ queryKey: [...cacheKeys.players, 'team', teamId], queryFn: () => api.players(`?team_id=${encodeURIComponent(teamId)}&limit=100`), enabled: Boolean(teamId) });
  const reports = useQuery({ queryKey: [...cacheKeys.reports, 'team', teamId], queryFn: () => api.playerReports(`?team_id=${encodeURIComponent(teamId)}&limit=100`), enabled: Boolean(teamId) });

  const create = useMutation({
    mutationFn: () => {
      const playerId = draft.playerIds[0];
      if (!playerId) throw new Error('Choose a player.');
      if (!draft.title.trim()) throw new Error('Give the report a name.');
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.start) || !/^\d{4}-\d{2}-\d{2}$/u.test(draft.end)) throw new Error('Enter both dates as YYYY-MM-DD.');
      return api.createPlayerReport({ player_id: playerId, title: draft.title.trim(), period_start: draft.start, period_end: draft.end, coach_feedback: draft.feedback.trim() });
    },
    onError: (error) => showMessage('Report not started', (error as Error).message),
    onSuccess: async () => {
      await invalidateAfterWrite(client, 'report');
      setDraft((current) => ({ ...current, playerIds: [], title: '', feedback: '' }));
      setFormOpen(false);
      confirmManageWrite('report', 'created');
    },
  });

  if (!teams.length) return <Text style={styles.empty}>Add a squad before writing reports.</Text>;
  const items = reports.data?.items ?? [];

  return <View style={styles.stack}>
    <ChoiceField label="Squad" onChange={setTeamId} options={teams.map((team) => ({ label: team.name, value: team.id }))} value={teamId} />

    <CollapsibleCard onOpenChange={setFormOpen} open={formOpen} summary="A period, and what you want to say about it." title="Write a report" tone="raised">
      <PlayerPickerField
        label="Player"
        onChange={(playerIds) => setDraft((current) => ({ ...current, playerIds }))}
        placeholder="Choose a player"
        players={players.data?.items ?? []}
        selectedIds={draft.playerIds}
        selectionMode="single"
      />
      <FormField label="What to call it" onChangeText={(title) => setDraft((current) => ({ ...current, title }))} placeholder="Autumn term" value={draft.title} />
      <FormField label="From" onChangeText={(start) => setDraft((current) => ({ ...current, start }))} placeholder="2026-09-01" value={draft.start} />
      <FormField label="To" onChangeText={(end) => setDraft((current) => ({ ...current, end }))} placeholder="2026-12-20" value={draft.end} />
      <FormField hint="The only part that is not worked out from the records" label="What you want to say" maxLength={5000} multiline onChangeText={(feedback) => setDraft((current) => ({ ...current, feedback }))} value={draft.feedback} />
      <AppButton label="Start report" loading={create.isPending} onPress={() => create.mutate()} />
    </CollapsibleCard>

    {reports.isError ? <ErrorState message={(reports.error as ApiError).message} onRetry={() => reports.refetch()} /> : <CollapsibleSection count={items.length} defaultOpen title="Reports">
      {reports.isLoading ? <LoadingState /> : !items.length ? <Text style={styles.empty}>No reports for this squad yet.</Text>
        : <View style={styles.list}>{items.map((report) => <ReportRow key={report.id} report={report} />)}</View>}
    </CollapsibleSection>}
  </View>;
}

/** One report: what it says, and what can be done with it. */
function ReportRow({ report }: { report: PlayerReport }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const client = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState(report.coach_feedback);
  const published = report.status === 'published';

  const act = (run: () => Promise<unknown>, done: string) => async () => {
    try { await run(); await invalidateAfterWrite(client, 'report'); showToast(done); }
    catch (error) { showMessage('Report not changed', (error as ApiError).message); }
  };

  const save = useMutation({
    mutationFn: () => api.updatePlayerReport(report.id, { coach_feedback: feedback }),
    onError: (error) => showMessage('Not saved', (error as ApiError).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'report'); showToast('Report saved'); },
  });

  const share = async () => {
    if (!report.share_token) return;
    try { await shareReport(report.share_token, report.player?.name ?? 'Your child'); }
    catch (error) { showMessage('Could not share', (error as Error).message); }
  };

  return <View style={styles.card}>
    <Pressable
      accessibilityLabel={`${report.player?.name ?? 'Player'}, ${report.title}, ${published ? 'published' : 'draft'}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((current) => !current)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.copy}>
        <Text style={styles.name}>{report.player?.name ?? 'Player'}</Text>
        <Text style={styles.meta}>{report.title} · {report.period_start} to {report.period_end}</Text>
      </View>
      <View style={[styles.chip, { borderColor: published ? colors.live : colors.textMuted }]}>
        <Text style={[styles.chipText, { color: published ? colors.live : colors.textMuted }]}>{published ? 'Published' : 'Draft'}</Text>
      </View>
    </Pressable>

    {open ? <View style={styles.body}>
      {/* A draft is measured again every time it is opened, so the coach writes
        * against the figures as they stand; publishing is what freezes them. */}
      <Text style={styles.source}>{published ? 'These figures were frozen when it was published.' : 'These figures are as they stand now.'}</Text>
      <ReportCard report={{ ...report, snapshot: report.snapshot }} />

      {published ? <>
        <Text style={styles.link} selectable>{report.share_token ? reportShareUrl(report.share_token) : ''}</Text>
        <Text style={styles.note}>
          {report.first_opened_at ? 'Opened by somebody with the link.' : 'Not opened yet.'} Anybody with this address can read it, so send it to the family rather than a group.
        </Text>
        <View style={styles.actions}>
          <AppButton compact icon="share-outline" label="Send to parent" onPress={share} />
          {Platform.OS === 'web' ? <AppButton compact label="Print" onPress={() => window.print()} variant="secondary" /> : null}
          <AppButton compact label="New link" onPress={() => confirmAction('Replace the link?', 'The address already sent will stop working.', 'Replace', act(() => api.replaceReportLink(report.id), 'New link made'), { destructive: true })} variant="secondary" />
          <AppButton compact label="Withdraw" onPress={() => confirmAction('Withdraw this report?', 'The link stops working and it goes back to a draft. Nothing is lost.', 'Withdraw', act(() => api.withdrawReport(report.id), 'Report withdrawn'), { destructive: true })} variant="danger" />
        </View>
      </> : <>
        <FormField label="What you want to say" maxLength={5000} multiline onChangeText={setFeedback} value={feedback} />
        <View style={styles.actions}>
          <AppButton compact disabled={feedback === report.coach_feedback} label="Save" loading={save.isPending} onPress={() => save.mutate()} variant="secondary" />
          <AppButton compact label="Publish and get a link" onPress={act(() => api.publishReport(report.id), 'Report published')} />
          <AppButton compact icon="trash" iconOnly label="Delete report" onPress={() => confirmAction('Delete this draft?', 'It has not been shared with anybody.', 'Delete', act(() => api.deletePlayerReport(report.id), 'Report deleted'), { destructive: true })} variant="danger" />
        </View>
      </>}
    </View> : null}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
  list: { gap: theme.spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, padding: theme.spacing.md },
  copy: { flex: 1 },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  meta: { color: colors.textMuted, fontSize: theme.type.label, marginTop: 2 },
  pressed: { opacity: 0.7 },
  body: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: theme.spacing.sm, padding: theme.spacing.md },
  source: { color: colors.textMuted, fontSize: theme.type.caption },
  link: { color: colors.accentSoft, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  note: { color: colors.textMuted, fontSize: theme.type.label, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  chip: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: theme.font.bold, fontSize: theme.type.caption },
  empty: { color: colors.textMuted },
});
