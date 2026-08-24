import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { DateTimeField } from '@/src/components/DateTimeField';
import { FormField } from '@/src/components/FormField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime, toEgyptWallClock } from '@/src/lib/egyptTime';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { expandWeekly } from '@/src/lib/trainingSchedule';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AdminAccount, Announcement, Player, Team, TrainingSession } from '@/src/types/api';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const positiveInteger = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function AccountsManager({ players }: { players: Player[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api.adminUsers('?limit=100') });
  const link = useMutation({
    mutationFn: ({ id, playerId }: { id: string; playerId: string | null }) => api.linkUserPlayer(id, playerId),
    onError: (error) => showMessage('Account not updated', (error as ApiError).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'account'); showToast('Account link updated'); },
  });
  if (accounts.isLoading) return <LoadingState label="Loading accounts" />;
  if (accounts.isError) return <ErrorState message={(accounts.error as ApiError).message} onRetry={() => accounts.refetch()} />;
  return <View style={styles.stack}>
    <Text style={styles.explainer}>Connect each player login to one roster record. Unlinking removes My Team access without deleting either account.</Text>
    {accounts.data?.items.map((account: AdminAccount) => <View key={account.id} style={styles.card}>
      <View style={styles.copy}>
        <Text style={styles.title}>{account.name}</Text>
        <Text style={styles.meta}>{account.email} · {account.role}</Text>
      </View>
      <ChoiceField
        label="Linked player"
        onChange={(playerId) => link.mutate({ id: account.id, playerId: playerId || null })}
        options={[{ label: 'No linked player', value: '' }, ...players.map((player) => ({ label: player.name, value: player.id }))]}
        value={account.player?.id ?? ''}
      />
    </View>)}
  </View>;
}

type ScheduleDraft = {
  teamId: string;
  startsAt: string;
  duration: string;
  venue: string;
  notes: string;
  recurrence: 'once' | 'weekly';
  weekdays: number[];
  endsOn: string;
};

const freshSchedule = (): ScheduleDraft => ({ teamId: '', startsAt: new Date().toISOString(), duration: '90', venue: '', notes: '', recurrence: 'once', weekdays: [], endsOn: '' });

export function ScheduleManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: ['training', 'admin'], queryFn: () => api.trainingSessions('?limit=100') });
  const [draft, setDraft] = React.useState<ScheduleDraft>(freshSchedule);
  const [editing, setEditing] = React.useState<TrainingSession | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!draft.teamId || !draft.venue.trim()) throw new Error('Choose a squad and enter a venue.');
      const start = new Date(draft.startsAt);
      if (Number.isNaN(start.getTime())) throw new Error('Enter a valid session date and time.');
      if (editing) return api.updateTrainingSession(editing.id, { starts_at: start.toISOString(), duration_minutes: positiveInteger(draft.duration, 90), venue: draft.venue.trim(), notes: draft.notes.trim() || null });
      const wallClock = toEgyptWallClock(start);
      const defaultWeekday = new Date(Date.UTC(wallClock.year, wallClock.month - 1, wallClock.day)).getUTCDay();
      const selected = draft.weekdays.length ? draft.weekdays : [defaultWeekday];
      const endParts = /^\d{4}-\d{2}-\d{2}$/.test(draft.endsOn) ? draft.endsOn.split('-').map(Number) : null;
      const occurrences = draft.recurrence === 'once' ? [start.toISOString()] : expandWeekly({
        weekdays: selected,
        wallClock,
        endsOn: endParts ? { year: endParts[0]!, month: endParts[1]!, day: endParts[2]! } : null,
      });
      if (!occurrences.length) throw new Error('The recurrence does not contain any sessions.');
      if (occurrences.length > 200) throw new Error('A schedule can contain at most 200 sessions.');
      return api.createTrainingSessions({ team_id: draft.teamId, venue: draft.venue.trim(), notes: draft.notes.trim() || null, duration_minutes: positiveInteger(draft.duration, 90), occurrences });
    },
    onError: (error) => showMessage('Schedule not saved', (error as Error).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'training'); setEditing(null); setDraft(freshSchedule()); showToast('Training schedule saved'); },
  });
  const remove = async (session: TrainingSession, scope: 'one' | 'series') => {
    try { await api.deleteTrainingSession(session.id, scope); await invalidateAfterWrite(client, 'training'); }
    catch (error) { showMessage('Session not deleted', (error as ApiError).message); }
  };
  const beginEdit = (session: TrainingSession) => { setEditing(session); setDraft({ teamId: session.team_id, startsAt: session.starts_at, duration: String(session.duration_minutes), venue: session.venue, notes: session.notes ?? '', recurrence: 'once', weekdays: [], endsOn: '' }); };
  const toggleWeekday = (day: number) => setDraft((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((value) => value !== day) : [...current.weekdays, day].sort() }));
  return <View style={styles.stack}>
    <View style={styles.formCard}>
      <Text style={styles.heading}>{editing ? 'Edit this occurrence' : 'Add training sessions'}</Text>
      <ChoiceField label="Squad" onChange={(teamId) => setDraft((current) => ({ ...current, teamId }))} options={teams.map((team) => ({ label: team.name, value: team.id }))} value={draft.teamId} />
      <DateTimeField label="First session (Egypt time)" onChange={(startsAt) => setDraft((current) => ({ ...current, startsAt }))} value={draft.startsAt} />
      {!editing ? <ChoiceField label="Repeat" onChange={(recurrence) => setDraft((current) => ({ ...current, recurrence: recurrence as ScheduleDraft['recurrence'] }))} options={[{ label: 'One-off', value: 'once' }, { label: 'Weekly', value: 'weekly' }]} value={draft.recurrence} /> : null}
      {!editing && draft.recurrence === 'weekly' ? <>
        <Text style={styles.label}>Weekdays</Text>
        <View accessibilityRole="radiogroup" style={styles.dayRow}>{weekdays.map((label, day) => <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.weekdays.includes(day) }} key={label} onPress={() => toggleWeekday(day)} style={[styles.day, draft.weekdays.includes(day) && styles.dayActive]}><Text style={[styles.dayText, draft.weekdays.includes(day) && styles.dayTextActive]}>{label}</Text></Pressable>)}</View>
        <DateTimeField dateOnly label="End date (optional; blank schedules 26 weeks)" onChange={(endsOn) => setDraft((current) => ({ ...current, endsOn }))} value={draft.endsOn} />
      </> : null}
      <FormField inputMode="numeric" keyboardType="number-pad" label="Duration (minutes)" onChangeText={(duration) => setDraft((current) => ({ ...current, duration }))} value={draft.duration} />
      <FormField label="Venue" onChangeText={(venue) => setDraft((current) => ({ ...current, venue }))} value={draft.venue} />
      <FormField label="Notes (optional)" multiline onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} value={draft.notes} />
      <View style={styles.actions}><AppButton label={editing ? 'Save occurrence' : 'Create schedule'} loading={save.isPending} onPress={() => save.mutate()} />{editing ? <AppButton label="Cancel" onPress={() => { setEditing(null); setDraft(freshSchedule()); }} variant="ghost" /> : null}</View>
    </View>
    {sessions.isLoading ? <LoadingState /> : sessions.isError ? <ErrorState message={(sessions.error as ApiError).message} onRetry={() => sessions.refetch()} /> : sessions.data?.items.map((session) => <Pressable key={session.id} onPress={() => router.push(`/training/${session.id}`)} style={styles.card}>
      <View style={styles.copy}><Text style={styles.title}>{session.team.name}</Text><Text style={styles.meta}>{formatEgyptDateTime(session.starts_at)} · {session.venue}</Text></View>
      <View style={styles.actions}><AppButton compact icon="pencil" iconOnly label="Edit occurrence" onPress={() => beginEdit(session)} variant="ghost" /><AppButton compact icon="trash" iconOnly label="Delete occurrence" onPress={() => confirmAction('Delete this session?', 'Only this occurrence will be removed.', 'Delete one', () => remove(session, 'one'), { destructive: true })} variant="danger" />{session.series_id ? <AppButton compact label="Delete series" onPress={() => confirmAction('Delete the full series?', 'Every occurrence in this series will be removed.', 'Delete series', () => remove(session, 'series'), { destructive: true })} variant="danger" /> : null}</View>
    </Pressable>)}
  </View>;
}

const blankAnnouncement = { teamId: '', title: '', body: '', pinned: false };

export function AnnouncementsManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const announcements = useQuery({ queryKey: ['announcements', 'admin'], queryFn: () => api.announcements('?limit=100') });
  const [draft, setDraft] = React.useState(blankAnnouncement);
  const [editing, setEditing] = React.useState<Announcement | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (!draft.title.trim() || !draft.body.trim()) throw new Error('Enter a title and message.');
      const payload = { team_id: draft.teamId || null, title: draft.title.trim(), body: draft.body.trim(), pinned: draft.pinned };
      return editing ? api.updateAnnouncement(editing.id, payload) : api.createAnnouncement(payload);
    },
    onError: (error) => showMessage('Announcement not saved', (error as Error).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'announcement'); setEditing(null); setDraft(blankAnnouncement); showToast('Announcement saved'); },
  });
  const beginEdit = (announcement: Announcement) => { setEditing(announcement); setDraft({ teamId: announcement.team_id ?? '', title: announcement.title, body: announcement.body, pinned: announcement.pinned }); };
  const remove = (announcement: Announcement) => confirmAction('Delete this announcement?', 'Players will no longer see it.', 'Delete', async () => { try { await api.deleteAnnouncement(announcement.id); await invalidateAfterWrite(client, 'announcement'); } catch (error) { showMessage('Announcement not deleted', (error as ApiError).message); } }, { destructive: true });
  return <View style={styles.stack}>
    <View style={styles.formCard}>
      <Text style={styles.heading}>{editing ? 'Edit announcement' : 'Post announcement'}</Text>
      <ChoiceField label="Audience" onChange={(teamId) => setDraft((current) => ({ ...current, teamId }))} options={[{ label: 'Whole academy', value: '' }, ...teams.map((team) => ({ label: team.name, value: team.id }))]} value={draft.teamId} />
      <FormField label="Title" onChangeText={(title) => setDraft((current) => ({ ...current, title }))} value={draft.title} />
      <FormField label="Message" multiline onChangeText={(body) => setDraft((current) => ({ ...current, body }))} value={draft.body} />
      <ChoiceField label="Priority" onChange={(value) => setDraft((current) => ({ ...current, pinned: value === 'pinned' }))} options={[{ label: 'Standard', value: 'standard' }, { label: 'Pinned', value: 'pinned' }]} value={draft.pinned ? 'pinned' : 'standard'} />
      <View style={styles.actions}><AppButton label={editing ? 'Save changes' : 'Publish'} loading={save.isPending} onPress={() => save.mutate()} />{editing ? <AppButton label="Cancel" onPress={() => { setEditing(null); setDraft(blankAnnouncement); }} variant="ghost" /> : null}</View>
    </View>
    {announcements.isLoading ? <LoadingState /> : announcements.isError ? <ErrorState message={(announcements.error as ApiError).message} onRetry={() => announcements.refetch()} /> : announcements.data?.items.map((announcement) => <View key={announcement.id} style={styles.card}>
      <View style={styles.copy}><Text style={styles.title}>{announcement.pinned ? 'Pinned · ' : ''}{announcement.title}</Text><Text style={styles.meta}>{announcement.team?.name ?? 'Whole academy'} · {announcement.author_name ?? 'Administrator'}</Text><Text style={styles.body}>{announcement.body}</Text></View>
      <View style={styles.actions}><AppButton compact icon="pencil" iconOnly label="Edit" onPress={() => beginEdit(announcement)} variant="ghost" /><AppButton compact icon="trash" iconOnly label="Delete" onPress={() => remove(announcement)} variant="danger" /></View>
    </View>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  body: { color: colors.textSecondary, lineHeight: 21, marginTop: theme.spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.md },
  copy: { flex: 1 },
  day: { alignItems: 'center', borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, minWidth: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  dayActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  dayText: { color: colors.textSecondary, fontWeight: '800' },
  dayTextActive: { color: colors.onAccent },
  explainer: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.md, color: colors.textSecondary, lineHeight: 22, padding: theme.spacing.md },
  formCard: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg },
  heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  meta: { color: colors.textMuted, marginTop: 4 },
  stack: { gap: theme.spacing.md },
  title: { color: colors.textPrimary, fontWeight: '900' },
});
