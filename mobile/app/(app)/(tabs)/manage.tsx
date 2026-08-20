import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { appConfig } from '@/src/config';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { theme } from '@/src/theme';
import { EXTRA_TIME_PERIODS, totalMatchMinutes } from '@/src/types/api';
import type { Competition, Match, MatchTimeStructure, Player, RegistrationInvite, Team } from '@/src/types/api';

type Resource = 'teams' | 'competitions' | 'players' | 'matches' | 'invites';
type Entity = Team | Competition | Player | Match | RegistrationInvite;
const resources: { label: string; value: Resource }[] = [{ label: 'Squads', value: 'teams' }, { label: 'Competitions', value: 'competitions' }, { label: 'Players', value: 'players' }, { label: 'Matches', value: 'matches' }, { label: 'Invites', value: 'invites' }];
const schema = z.object({ name: z.string(), code: z.string(), ageGroup: z.string(), season: z.string(), isAimz: z.string(), type: z.string(), teamId: z.string(), position: z.string(), jersey: z.string(), competitionId: z.string(), homeTeamId: z.string(), awayTeamId: z.string(), kickoff: z.string(), venue: z.string(), status: z.string(), halfLength: z.string(), numHalves: z.string(), halfTimeBreak: z.string(), hasExtraTime: z.string(), extraTimeLength: z.string(), label: z.string() });
type Values = z.infer<typeof schema>;
const defaults: Values = { name: '', code: '', ageGroup: '', season: '', isAimz: 'true', type: 'league', teamId: '', position: '', jersey: '', competitionId: '', homeTeamId: '', awayTeamId: '', kickoff: new Date().toISOString(), venue: '', status: 'scheduled', halfLength: '45', numHalves: '2', halfTimeBreak: '15', hasExtraTime: 'false', extraTimeLength: '15', label: '' };

/** Parses the three period inputs, or null when any is not a whole number in range. */
function readTimeStructure(values: Pick<Values, 'halfLength' | 'numHalves' | 'halfTimeBreak' | 'hasExtraTime' | 'extraTimeLength'>): MatchTimeStructure | null {
  const read = (raw: string, min: number, max: number) => {
    const parsed = Number(raw.trim());
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const half_length_minutes = read(values.halfLength, 1, 90);
  const num_halves = read(values.numHalves, 1, 4);
  const half_time_break_minutes = read(values.halfTimeBreak, 0, 30);
  const has_extra_time = values.hasExtraTime === 'true';
  const extra_time_half_length_minutes = read(values.extraTimeLength, 1, 30);
  if (half_length_minutes === null || num_halves === null || half_time_break_minutes === null) return null;
  if (has_extra_time && extra_time_half_length_minutes === null) return null;
  return { half_length_minutes, num_halves, half_time_break_minutes, has_extra_time, extra_time_half_length_minutes: extra_time_half_length_minutes ?? 15 };
}

function ExtraTimeLength({ control }: { control: Control<Values> }) {
  const hasExtraTime = useWatch({ control, name: 'hasExtraTime' });
  if (hasExtraTime !== 'true') return null;
  return <Controller control={control} name="extraTimeLength" render={({ field }) => <FormField hint={`Minutes per extra-time period (${EXTRA_TIME_PERIODS} played)`} inputMode="numeric" keyboardType="number-pad" label="Extra-time period length (minutes)" onChangeText={field.onChange} value={field.value} />} />;
}

function MatchLengthSummary({ control }: { control: Control<Values> }) {
  const [halfLength, numHalves, halfTimeBreak, hasExtraTime, extraTimeLength] = useWatch({ control, name: ['halfLength', 'numHalves', 'halfTimeBreak', 'hasExtraTime', 'extraTimeLength'] });
  const structure = readTimeStructure({ halfLength, numHalves, halfTimeBreak, hasExtraTime, extraTimeLength });
  if (!structure) return <Text style={styles.summaryInvalid}>Enter whole numbers to see the total match length.</Text>;
  const { half_length_minutes: half, num_halves: halves, half_time_break_minutes: term } = structure;
  const breaks = halves - 1;
  const parts = [`${halves} × ${half} min ${halves === 1 ? 'period' : 'halves'}`];
  if (breaks > 0) parts.push(`${breaks > 1 ? `${breaks} × ` : ''}${term} min half-time`);
  if (structure.has_extra_time) parts.push(`${EXTRA_TIME_PERIODS} × ${structure.extra_time_half_length_minutes} min extra time`);
  return <Text accessibilityLiveRegion="polite" style={styles.summary}>Total match length: {totalMatchMinutes(structure)} minutes ({parts.join(' + ')})</Text>;
}

export default function ManageScreen() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [resource, setResource] = React.useState<Resource>('teams');
  const [editing, setEditing] = React.useState<Entity | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const teams = useQuery({ queryKey: ['teams', 'admin'], queryFn: () => api.teams('?limit=100') });
  const competitions = useQuery({ queryKey: ['competitions'], queryFn: () => api.competitions('?limit=100') });
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const matches = useQuery({ queryKey: ['matches', 'admin'], queryFn: () => api.matches('?limit=100') });
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites, enabled: user?.role === 'admin' });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;

  const switchResource = (next: Resource) => { setResource(next); setEditing(null); form.reset(defaults); setFormError(null); };
  const query = resource === 'teams' ? teams : resource === 'competitions' ? competitions : resource === 'players' ? players : resource === 'matches' ? matches : invites;
  const items: Entity[] = resource === 'teams' ? teams.data?.items ?? [] : resource === 'competitions' ? competitions.data?.items ?? [] : resource === 'players' ? players.data?.items ?? [] : resource === 'matches' ? matches.data?.items ?? [] : invites.data ?? [];
  // Every admin write clears the views built on it, including derived ones
  // like standings, leaderboards and squad counts.
  const entityFor: Record<Resource, Parameters<typeof invalidateAfterWrite>[1]> = { teams: 'team', players: 'player', competitions: 'competition', matches: 'match', invites: 'invite' };
  const invalidate = async () => { await invalidateAfterWrite(client, entityFor[resource]); };

  const save = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (resource === 'teams') {
        if (!values.name.trim()) throw new Error('Enter a team or squad name.');
        const payload = { name: values.name.trim(), squad_code: values.code.trim() || null, age_group: values.ageGroup.trim() || null, season: values.season.trim() || null, is_aimz: values.isAimz === 'true', is_active: true, logo_key: editing && 'logo_key' in editing ? editing.logo_key : null };
        editing ? await api.updateTeam(editing.id, payload) : await api.createTeam(payload);
      } else if (resource === 'competitions') {
        if (!values.name.trim() || !values.season.trim()) throw new Error('Enter a competition name and season.');
        const payload = { name: values.name.trim(), season: values.season.trim(), type: values.type as Competition['type'] };
        editing ? await api.updateCompetition(editing.id, payload) : await api.createCompetition(payload);
      } else if (resource === 'players') {
        if (!values.name.trim() || !values.teamId || !values.position.trim()) throw new Error('Enter the player name, squad and position.');
        const payload = { name: values.name.trim(), team_id: values.teamId, position: values.position.trim(), jersey_number: values.jersey ? Number(values.jersey) : null, photo_key: editing && 'photo_key' in editing ? editing.photo_key : null, is_active: true };
        editing ? await api.updatePlayer(editing.id, payload) : await api.createPlayer(payload);
      } else if (resource === 'matches') {
        if (!values.competitionId || !values.homeTeamId || !values.awayTeamId || !values.venue.trim() || Number.isNaN(Date.parse(values.kickoff))) throw new Error('Complete the competition, teams, kickoff and venue.');
        const structure = readTimeStructure(values);
        if (!structure) throw new Error('Half length, number of halves, and half-time break must be whole numbers.');
        const payload = { competition_id: values.competitionId, home_team_id: values.homeTeamId, away_team_id: values.awayTeamId, kickoff_datetime: new Date(values.kickoff).toISOString(), venue: values.venue.trim(), status: values.status as Match['status'], ...structure };
        editing ? await api.updateMatch(editing.id, payload) : await api.createMatch(payload);
      } else {
        if (!values.label.trim() || !values.code.trim()) throw new Error('Enter an invite label and code.');
        await api.createInvite({ label: values.label.trim(), code: values.code.trim() });
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidate(); setEditing(null); form.reset(defaults);
    } catch (error) { setFormError(error instanceof ApiError || error instanceof Error ? error.message : 'Could not save this item.'); }
  });

  const beginEdit = (item: Entity) => {
    setEditing(item); setFormError(null);
    if (resource === 'teams' && 'is_aimz' in item) form.reset({ ...defaults, name: item.name, code: item.squad_code ?? '', ageGroup: item.age_group ?? '', season: item.season ?? '', isAimz: String(item.is_aimz) });
    if (resource === 'competitions' && 'type' in item && !('status' in item)) form.reset({ ...defaults, name: item.name, season: item.season, type: item.type });
    if (resource === 'players' && 'position' in item) form.reset({ ...defaults, name: item.name, teamId: item.team_id, position: item.position, jersey: item.jersey_number?.toString() ?? '' });
    if (resource === 'matches' && 'status' in item) form.reset({ ...defaults, competitionId: item.competition_id, homeTeamId: item.home_team_id, awayTeamId: item.away_team_id, kickoff: item.kickoff_datetime, venue: item.venue, status: item.status, halfLength: String(item.half_length_minutes ?? 45), numHalves: String(item.num_halves ?? 2), halfTimeBreak: String(item.half_time_break_minutes ?? 15), hasExtraTime: item.has_extra_time ? 'true' : 'false', extraTimeLength: String(item.extra_time_half_length_minutes ?? 15) });
  };

  const remove = (item: Entity) => Alert.alert('Delete this item?', 'This cannot be undone. Referenced squads, players, or competitions must be archived instead.', [{ text: 'Cancel', style: 'cancel' }, { text: resource === 'invites' ? 'Revoke' : 'Delete', style: 'destructive', onPress: async () => { try { if (resource === 'teams') await api.deleteTeam(item.id); if (resource === 'competitions') await api.deleteCompetition(item.id); if (resource === 'players') await api.deletePlayer(item.id); if (resource === 'matches') await api.deleteMatch(item.id); if (resource === 'invites') await api.revokeInvite(item.id); await invalidate(); } catch (error) { Alert.alert('Could not delete', (error as ApiError).message); } } }]);

  const uploadPhoto = async (item: Team | Player, entity: 'team' | 'player') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Photo access needed', 'Allow photo access to upload a roster image.'); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (picked.canceled) return;
    try {
      const asset = picked.assets[0];
      if (!asset) return;
      const image = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1200 } }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
      const presign = await api.presign(entity, item.id, 'image/jpeg');
      const data = new FormData(); Object.entries(presign.fields).forEach(([key, value]) => data.append(key, value)); data.append('file', { uri: image.uri, name: 'aimz-photo.jpg', type: 'image/jpeg' } as unknown as Blob);
      const uploaded = await fetch(presign.upload_url, { method: 'POST', body: data });
      if (!uploaded.ok) throw new Error('The storage service rejected the upload.');
      if (entity === 'team') await api.updateTeam(item.id, { ...(item as Team), logo_key: presign.object_key }); else await api.updatePlayer(item.id, { ...(item as Player), photo_key: presign.object_key });
      await invalidate();
    } catch (error) { Alert.alert('Upload failed', (error as Error).message); }
  };

  return <Screen eyebrow="Administrator tools" title="Manage academy">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{resources.map((item) => <Pressable key={item.value} onPress={() => switchResource(item.value)} style={({ pressed }) => [styles.chip, resource === item.value && styles.chipActive, pressed && styles.pressed]}><Text style={[styles.chipText, resource === item.value && styles.chipTextActive]}>{item.label}</Text></Pressable>)}</ScrollView>
    {!appConfig.enableMedia && (resource === 'teams' || resource === 'players') ? <View style={styles.previewNote}><Text style={styles.previewNoteTitle}>Placeholder images only</Text><Text style={styles.previewNoteCopy}>Photo uploads are disabled in the free staging preview.</Text></View> : null}
    <View style={styles.formCard}><Text style={styles.heading}>{editing ? 'Edit' : 'Add'} {resources.find((item) => item.value === resource)?.label.toLowerCase()}</Text>{formError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{formError}</Text> : null}<ResourceFields control={form.control} errors={form.formState.errors} resource={resource} teams={teams.data?.items ?? []} competitions={competitions.data?.items ?? []} /><View style={styles.actions}><AppButton label={editing ? 'Save changes' : 'Add item'} loading={form.formState.isSubmitting} onPress={save} style={styles.flexButton} />{editing ? <AppButton label="Cancel" onPress={() => { setEditing(null); form.reset(defaults); }} variant="ghost" /> : null}</View></View>
    <View style={styles.listHeader}><Text style={styles.heading}>Current {resources.find((item) => item.value === resource)?.label.toLowerCase()}</Text><Text style={styles.count}>{items.length}</Text></View>
    {query.isLoading ? <LoadingState /> : query.isError ? <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} /> : items.length === 0 ? <Text style={styles.empty}>Nothing has been added yet.</Text> : <View style={styles.list}>{items.map((item) => <View key={item.id} style={styles.item}><View style={styles.itemCopy}><Text style={styles.itemTitle}>{entityTitle(item)}</Text><Text style={styles.itemMeta}>{entityMeta(item)}</Text></View><View style={styles.rowActions}>{resource !== 'invites' ? <AppButton compact label="Edit" onPress={() => beginEdit(item)} variant="ghost" /> : null}{resource === 'matches' && 'status' in item ? <AppButton compact label={item.status === 'scheduled' ? 'Start' : 'Score'} onPress={() => router.push(`/live/${item.id}`)} variant="secondary" /> : null}{appConfig.enableMedia && (resource === 'teams' || resource === 'players') ? <AppButton compact label="Photo" onPress={() => uploadPhoto(item as Team | Player, resource === 'teams' ? 'team' : 'player')} variant="secondary" /> : null}<AppButton compact label={resource === 'invites' ? 'Revoke' : 'Delete'} onPress={() => remove(item)} variant="danger" /></View></View>)}</View>}
  </Screen>;
}

function ResourceFields({ control, errors, resource, teams, competitions }: { control: any; errors: any; resource: Resource; teams: Team[]; competitions: Competition[] }) {
  if (resource === 'teams') return <><Controller control={control} name="name" render={({ field }) => <FormField label="Team or squad name" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="code" render={({ field }) => <FormField label="Squad code" onChangeText={field.onChange} placeholder="RTS S14" value={field.value} />} /><View style={styles.two}><Controller control={control} name="ageGroup" render={({ field }) => <FormField label="Age group" onChangeText={field.onChange} placeholder="U14" style={styles.flexButton} value={field.value} />} /><Controller control={control} name="season" render={({ field }) => <FormField label="Season" onChangeText={field.onChange} placeholder="2026/27" style={styles.flexButton} value={field.value} />} /></View><Controller control={control} name="isAimz" render={({ field }) => <ChoiceField label="Team type" onChange={field.onChange} options={[{ label: 'AIMZ squad', value: 'true' }, { label: 'Opponent', value: 'false' }]} value={field.value} />} /></>;
  if (resource === 'competitions') return <><Controller control={control} name="name" render={({ field }) => <FormField label="Competition name" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="season" render={({ field }) => <FormField label="Season" onChangeText={field.onChange} placeholder="2026/27" value={field.value} />} /><Controller control={control} name="type" render={({ field }) => <ChoiceField label="Format" onChange={field.onChange} options={[{ label: 'League', value: 'league' }, { label: 'Tournament', value: 'tournament' }, { label: 'Friendly', value: 'friendly' }]} value={field.value} />} /></>;
  if (resource === 'players') return <><Controller control={control} name="name" render={({ field }) => <FormField label="Player name" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="teamId" render={({ field }) => <ChoiceField label="Squad" onChange={field.onChange} options={teams.map((item) => ({ label: item.name, value: item.id }))} value={field.value} />} /><View style={styles.two}><Controller control={control} name="position" render={({ field }) => <FormField label="Position" onChangeText={field.onChange} style={styles.flexButton} value={field.value} />} /><Controller control={control} name="jersey" render={({ field }) => <FormField keyboardType="number-pad" label="Number" onChangeText={field.onChange} style={styles.flexButton} value={field.value} />} /></View></>;
  if (resource === 'matches') return <><Controller control={control} name="competitionId" render={({ field }) => <ChoiceField label="Competition" onChange={field.onChange} options={competitions.map((item) => ({ label: `${item.name} · ${item.season}`, value: item.id }))} value={field.value} />} /><Controller control={control} name="homeTeamId" render={({ field }) => <ChoiceField label="Home team" onChange={field.onChange} options={teams.map((item) => ({ label: item.name, value: item.id }))} value={field.value} />} /><Controller control={control} name="awayTeamId" render={({ field }) => <ChoiceField label="Away team" onChange={field.onChange} options={teams.map((item) => ({ label: item.name, value: item.id }))} value={field.value} />} /><Controller control={control} name="kickoff" render={({ field }) => <FormField autoCapitalize="none" hint="ISO date and time, for example 2026-09-05T18:30:00+03:00" label="Kickoff" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="halfLength" render={({ field }) => <FormField hint="Minutes per half" inputMode="numeric" keyboardType="number-pad" label="Half length (minutes)" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="numHalves" render={({ field }) => <FormField hint="Two for standard football" inputMode="numeric" keyboardType="number-pad" label="Number of halves" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="halfTimeBreak" render={({ field }) => <FormField inputMode="numeric" keyboardType="number-pad" label="Half-time break (minutes)" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="hasExtraTime" render={({ field }) => <ChoiceField label="Extra time" onChange={field.onChange} options={[{ label: 'No extra time', value: 'false' }, { label: `Yes, ${EXTRA_TIME_PERIODS} periods`, value: 'true' }]} value={field.value} />} /><ExtraTimeLength control={control} /><MatchLengthSummary control={control} /><Controller control={control} name="venue" render={({ field }) => <FormField label="Venue" onChangeText={field.onChange} value={field.value} />} /></>;
  return <><Controller control={control} name="label" render={({ field }) => <FormField label="Invite label" onChangeText={field.onChange} placeholder="Autumn intake" value={field.value} />} /><Controller control={control} name="code" render={({ field }) => <FormField autoCapitalize="characters" label="Invite code" onChangeText={field.onChange} placeholder="AIMZ-2026" value={field.value} />} /></>;
}

function entityTitle(item: Entity) { if ('home_team_id' in item) return `${item.home_team?.name ?? 'Home'} vs ${item.away_team?.name ?? 'Away'}`; if ('position' in item) return item.name; if ('use_count' in item) return item.label; return item.name; }
function entityMeta(item: Entity) { if ('home_team_id' in item) return `${item.status.toUpperCase()} · ${new Date(item.kickoff_datetime).toLocaleString('en-EG')}`; if ('position' in item) return `${item.position} · #${item.jersey_number ?? '–'}`; if ('use_count' in item) return `${item.is_active ? 'Active' : 'Revoked'} · ${item.use_count} uses`; if ('is_aimz' in item) return item.squad_code ?? (item.is_aimz ? 'AIMZ squad' : 'Opponent'); return `${item.type} · ${item.season}`; }

const styles = StyleSheet.create({ summary: { color: theme.colors.lightBlue, fontSize: theme.type.label, fontWeight: '700', lineHeight: 20, marginTop: -theme.spacing.xs }, summaryInvalid: { color: theme.colors.textMuted, fontSize: theme.type.label, lineHeight: 20, marginTop: -theme.spacing.xs }, chips: { gap: theme.spacing.sm }, chip: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipActive: { backgroundColor: theme.colors.accent }, chipText: { color: theme.colors.textSecondary, fontWeight: '800' }, chipTextActive: { color: theme.colors.onAccent }, pressed: { opacity: 0.7 }, previewNote: { backgroundColor: theme.colors.warningSurface, borderColor: theme.colors.warning, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md }, previewNoteTitle: { color: theme.colors.warningText, fontWeight: '900' }, previewNoteCopy: { color: theme.colors.textPrimary, lineHeight: 22 }, formCard: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg }, heading: { color: theme.colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, error: { color: theme.colors.errorText }, two: { flexDirection: 'row', gap: theme.spacing.sm }, actions: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm }, flexButton: { flex: 1 }, listHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, count: { color: theme.colors.lightBlue, fontWeight: '900' }, empty: { color: theme.colors.textMuted, textAlign: 'center' }, list: { gap: theme.spacing.sm }, item: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.md }, itemCopy: { flex: 1 }, itemTitle: { color: theme.colors.textPrimary, fontWeight: '900' }, itemMeta: { color: theme.colors.textMuted, marginTop: 4 }, rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs } });
