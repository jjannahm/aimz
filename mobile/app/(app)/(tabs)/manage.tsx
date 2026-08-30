import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AnimatedTabPill } from '@/src/components/AnimatedTabPill';
import { SeasonControls } from '@/src/components/manage/SeasonControls';
import { ChoiceField } from '@/src/components/ChoiceField';
import { CollapsibleSection } from '@/src/components/CollapsibleSection';
import { DateTimeField } from '@/src/components/DateTimeField';
import { FamilyIcon } from '@/src/components/FamilyIcon';
import { FormField } from '@/src/components/FormField';
import { PlayerPickerField } from '@/src/components/PlayerPickerField';
import { PositionField } from '@/src/components/PositionField';
import { AccountsSection } from '@/src/components/manage/AccountsSection';
import { BulkPlayerImport } from '@/src/components/manage/BulkPlayerImport';
import { AnnouncementsManager, ScheduleManager } from '@/src/components/manage/HubManagers';
import { Screen } from '@/src/components/Screen';
import { narrowBySearch } from '@/src/components/SearchField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { appConfig } from '@/src/config';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { confirmManageSave, confirmManageWrite, type ManageEntity } from '@/src/lib/manageToasts';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { ADVANCE_PER_GROUP, describeCustomDraw, EXTRA_TIME_PERIODS, GROUP_SIZE, isKnockout, KNOCKOUT_TEAM_COUNTS, totalMatchMinutes } from '@/src/types/api';
import type { BadgeStyle, Competition, InviteKind, Match, MatchTimeStructure, Player, RegistrationInvite, Team } from '@/src/types/api';

type LegacyResource = 'teams' | 'competitions' | 'opponents' | 'players' | 'matches' | 'invites';
type HubResource = 'schedule' | 'announcements';
type Resource = LegacyResource | HubResource;
type Entity = Team | Competition | Player | Match | RegistrationInvite;
/** `short`, where it is given, is the wording the navigation pill uses: a
 * quarter of a phone's width does not hold every label at the pill's type size. */
const resources: { label: string; short?: string; value: Resource }[] = [{ label: 'Squads', value: 'teams' }, { label: 'Competitions', value: 'competitions' }, { label: 'Opponents', value: 'opponents' }, { label: 'Players', value: 'players' }, { label: 'Matches', value: 'matches' }, { label: 'Schedule', value: 'schedule' }, { label: 'Announcements', short: 'Announce', value: 'announcements' }, { label: 'Invites', value: 'invites' }];
const schema = z.object({ name: z.string(), code: z.string(), ageGroup: z.string(), season: z.string(), type: z.string(), teamId: z.string(), position: z.string(), jersey: z.string(), competitionId: z.string(), homeTeamId: z.string(), awayTeamId: z.string(), kickoff: z.string(), venue: z.string(), status: z.string(), halfLength: z.string(), numHalves: z.string(), halfTimeBreak: z.string(), coach: z.string(), assistantCoach: z.string(), teamCompetitionId: z.string(), hasExtraTime: z.string(), extraTimeLength: z.string(), label: z.string(), teamCount: z.string(), teamGroupId: z.string(), groupCount: z.string(), groupSize: z.string(), inviteKind: z.string(), invitePlayerIds: z.string(), badgeStyle: z.string() });
type Values = z.infer<typeof schema>;
const defaults: Values = { name: '', code: '', ageGroup: '', season: '', type: 'league', teamId: '', position: '', jersey: '', competitionId: '', homeTeamId: '', awayTeamId: '', kickoff: new Date().toISOString(), venue: '', status: 'scheduled', halfLength: '45', numHalves: '2', halfTimeBreak: '15', coach: '', assistantCoach: '', teamCompetitionId: '', hasExtraTime: 'false', extraTimeLength: '15', label: '', teamCount: '', teamGroupId: '', groupCount: '4', groupSize: '4', inviteKind: 'player', invitePlayerIds: '', badgeStyle: '' };

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

/** The draw size, which only a knockout has. */
function KnockoutSize({ control, competitionId, teams }: { control: Control<Values>; competitionId: string | null; teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const type = useWatch({ control, name: 'type' });
  const [teamCount, groupCount, groupSize] = useWatch({ control, name: ['teamCount', 'groupCount', 'groupSize'] });
  const groups = useQuery({ queryKey: ['competition-groups', competitionId], queryFn: () => api.groups(competitionId!), enabled: Boolean(competitionId) });
  if (type !== 'tournament') return null;
  // Redrawing the groups would orphan everyone already placed in one, so the
  // size stops being a choice the moment the first team is entered.
  const drawn = groups.data?.some((group) => group.teams.length > 0) ?? false;
  const custom = teamCount === CUSTOM_DRAW;
  return <>
    {drawn
      ? <View style={styles.lockedField}>
        <Text style={styles.lockedLabel}>Number of teams</Text>
        <Text style={styles.lockedValue}>{describeDraw(groups.data?.length ?? 0, Number(groupSize) || 0)}</Text>
      </View>
      : <Controller control={control} name="teamCount" render={({ field }) => <ChoiceField label="Number of teams" onChange={field.onChange} options={[...KNOCKOUT_TEAM_COUNTS.map((count) => ({ label: describeDraw(count / 4, 4), value: String(count) })), { label: 'Custom…', value: CUSTOM_DRAW }]} placeholder="Choose a size" value={field.value} />} />}
    {custom && !drawn ? <CustomDraw control={control} groupCount={groupCount} groupSize={groupSize} /> : null}
    <Text style={styles.pickerNote}>{drawn
      ? 'The size is fixed because teams have been entered. Empty every group to change it.'
      : competitionId
        ? 'Groups and an empty bracket are drawn up as soon as the competition is saved. The size is fixed once teams are entered.'
        : 'Groups and an empty bracket are drawn up as soon as this competition is saved, and teams can be entered from here afterwards.'}</Text>
    {competitionId ? <KnockoutGroups competitionId={competitionId} teams={teams} /> : null}
  </>;
}

/**
 * The draw, done from the competition itself.
 *
 * Teams can also be pointed at a group one at a time from the Squads and
 * Opponents forms; both write the same `competition_group_id`, so the two stay
 * in step with each other.
 */
function KnockoutGroups({ competitionId, teams }: { competitionId: string; teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);
  const groups = useQuery({ queryKey: ['competition-groups', competitionId], queryFn: () => api.groups(competitionId) });
  const assign = useMutation({
    mutationFn: ({ groupId, teamIds }: { groupId: string; teamIds: string[] }) => api.setGroupTeams(competitionId, groupId, teamIds),
    onError: (failure) => setError((failure as ApiError).message),
    onSuccess: async () => { setError(null); await invalidateAfterWrite(client, 'bracket', 'team'); },
  });
  if (groups.isLoading) return <Text style={styles.pickerNote}>Loading groups…</Text>;
  if (!groups.data?.length) return <Text style={styles.pickerNote}>Save the competition to draw up its groups.</Text>;
  const drawnElsewhere = new Set(groups.data.flatMap((group) => group.teams.map((team) => team.id)));
  return <View style={styles.groupList}>
    <Text style={styles.groupsHeading}>Groups & teams</Text>
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {groups.data.map((group) => {
      const full = group.teams.length >= GROUP_SIZE;
      const available = teams.filter((team) => !drawnElsewhere.has(team.id));
      return <View key={group.id} style={styles.groupCard}>
        <View style={styles.groupHeader}>
          <Text style={styles.groupTitle}>{group.name}</Text>
          <Text style={[styles.groupCount, full && styles.groupCountFull]}>{group.teams.length} of {GROUP_SIZE}</Text>
        </View>
        {group.teams.length
          ? group.teams.map((team) => <View key={team.id} style={styles.groupTeam}>
            <Text numberOfLines={1} style={styles.groupTeamName}>{team.name}</Text>
            <AppButton compact disabled={assign.isPending} label="Remove" onPress={() => assign.mutate({ groupId: group.id, teamIds: group.teams.filter((item) => item.id !== team.id).map((item) => item.id) })} variant="ghost" />
          </View>)
          : <Text style={styles.pickerNote}>No teams drawn yet.</Text>}
        {full
          ? <Text style={styles.pickerNote}>This group is full. Remove a team before adding another.</Text>
          : <ChoiceField
            label="Add a team"
            onChange={(teamId) => { if (teamId) assign.mutate({ groupId: group.id, teamIds: [...group.teams.map((team) => team.id), teamId] }); }}
            options={available.length ? available.map((team) => ({ label: `${team.name} · ${team.is_aimz ? 'AIMZ' : 'Opponent'}`, value: team.id })) : [{ label: 'Every team is already drawn', value: '' }]}
            placeholder="Choose a team"
            value=""
          />}
      </View>;
    })}
  </View>;
}

/**
 * The form values a saved knockout reopens on.
 *
 * A shape that matches one of the presets shows as that preset; anything else
 * is a custom draw, and its two numbers are filled in.
 */
function knockoutFormValues(item: Competition): Pick<Values, 'teamCount' | 'groupCount' | 'groupSize'> {
  if (!item.team_count) return { teamCount: '', groupCount: '4', groupSize: '4' };
  const size = item.group_size ?? GROUP_SIZE;
  const count = item.team_count / size;
  const preset = size === GROUP_SIZE && (KNOCKOUT_TEAM_COUNTS as readonly number[]).includes(item.team_count);
  return { teamCount: preset ? String(item.team_count) : CUSTOM_DRAW, groupCount: String(count), groupSize: String(size) };
}

/** The sentinel the size picker uses for a draw the admin shapes themselves. */
const CUSTOM_DRAW = 'custom';

/** "24 teams · 6 groups of 4", the phrasing the presets already read in. */
const describeDraw = (groupCount: number, groupSize: number) => `${groupCount * groupSize} teams · ${groupCount} groups of ${groupSize}`;

/**
 * A draw the admin shapes themselves.
 *
 * The total is shown as it is typed, and a shape that would not make a bracket
 * says so here rather than being refused on save.
 */
function CustomDraw({ control, groupCount, groupSize }: { control: Control<Values>; groupCount: string; groupSize: string }) {
  const styles = useThemedStyles(stylesheet);
  const counts = { groups: Number(groupCount), size: Number(groupSize) };
  const problem = describeCustomDraw(counts.groups, counts.size);
  return <>
    <View style={styles.two}>
      <Controller control={control} name="groupCount" render={({ field }) => <FormField containerStyle={styles.flexButton} inputMode="numeric" keyboardType="number-pad" label="Number of groups" onChangeText={field.onChange} value={field.value} />} />
      <Controller control={control} name="groupSize" render={({ field }) => <FormField containerStyle={styles.flexButton} inputMode="numeric" keyboardType="number-pad" label="Teams per group" onChangeText={field.onChange} value={field.value} />} />
    </View>
    {problem
      ? <Text accessibilityLiveRegion="polite" style={styles.error}>{problem}</Text>
      : <Text accessibilityLiveRegion="polite" style={styles.summary}>{describeDraw(counts.groups, counts.size)} · {counts.groups * ADVANCE_PER_GROUP} through to the bracket</Text>}
  </>;
}

/** Which group of a knockout the team is drawn into. */
function TeamGroup({ competitions, control }: { competitions: Competition[]; control: Control<Values> }) {
  const competitionId = useWatch({ control, name: 'teamCompetitionId' });
  const competition = competitions.find((item) => item.id === competitionId);
  const groups = useQuery({ queryKey: ['competition-groups', competitionId], queryFn: () => api.groups(competitionId), enabled: Boolean(competitionId) && isKnockout(competition) });
  if (!isKnockout(competition) || !groups.data?.length) return null;
  return <Controller control={control} name="teamGroupId" render={({ field }) => <ChoiceField label="Group" onChange={field.onChange} options={[{ label: 'Not drawn yet', value: '' }, ...groups.data.map((group) => ({ label: group.name, value: group.id }))]} placeholder="Choose a group" value={field.value} />} />;
}

function MatchLengthSummary({ control }: { control: Control<Values> }) {
  const styles = useThemedStyles(stylesheet);
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
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const client = useQueryClient();
  const [resource, setResource] = React.useState<Resource>('teams');
  const [editing, setEditing] = React.useState<Entity | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  /** What the list below is narrowed to, which each section starts free of. */
  const [search, setSearch] = React.useState('');
  /** Knockouts created in this sitting, whose next save completes their setup. */
  const [drawnUp, setDrawnUp] = React.useState<string[]>([]);
  const pageRef = React.useRef<ScrollView | null>(null);
  const teams = useQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams('?limit=100') });
  const competitions = useQuery({ queryKey: ['competitions'], queryFn: () => api.competitions('?limit=100') });
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const matches = useQuery({ queryKey: ['matches', 'admin'], queryFn: () => api.matches('?limit=100') });
  const invites = useQuery({ queryKey: ['invites'], queryFn: api.invites, enabled: user?.role === 'admin' });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;

  const switchResource = (next: Resource) => { setResource(next); setEditing(null); form.reset(defaults); setFormError(null); setSearch(''); };
  // Eight sections stay visible in a fixed two-by-four grid. Every cell keeps
  // its quarter of the width whatever it holds, so the two rows line up, and
  // the cells stretch their pills to an even row height.
  const resourceChips = <View style={styles.chips}>{resources.map((item) => <View key={item.value} style={styles.chipCell}>
    <AnimatedTabPill accessibilityLabel={item.label} compact label={item.short ?? item.label} onPress={() => switchResource(item.value)} selected={resource === item.value} style={styles.chip} testID={`manage-tab-${item.value}`} />
  </View>)}</View>;
  // The academy's own age squads, which is what a session or a notice is for.
  // `is_aimz` alone would name the league's clubs too: they carry it so that
  // players, lineups and live scoring work for them, and they have no age group.
  const aimzTeams = teams.data?.items.filter((team) => team.is_aimz && team.is_active && team.age_group) ?? [];
  if (resource === 'schedule' || resource === 'announcements') return <Screen scrollRef={pageRef} title="Manage Academy">
    {resourceChips}
    <View style={styles.content} testID="manage-content">
      {resource === 'schedule' ? <ScheduleManager teams={aimzTeams} /> : <AnnouncementsManager teams={aimzTeams} />}
    </View>
  </Screen>;
  const query = resource === 'teams' || resource === 'opponents' ? teams : resource === 'competitions' ? competitions : resource === 'players' ? players : resource === 'matches' ? matches : invites;
  const allTeams = teams.data?.items ?? [];
  const items: Entity[] = resource === 'teams' ? allTeams.filter((team) => team.is_aimz) : resource === 'opponents' ? allTeams.filter((team) => !team.is_aimz) : resource === 'competitions' ? competitions.data?.items ?? [] : resource === 'players' ? players.data?.items ?? [] : resource === 'matches' ? matches.data?.items ?? [] : invites.data ?? [];
  const listLabel = resources.find((item) => item.value === resource)?.label.toLowerCase() ?? 'items';
  // A hundred players is quicker to search than to scroll. A row is matched on
  // the two lines it actually shows, so a position or a shirt number finds one.
  const shown = narrowBySearch(items, search, (item) => `${entityTitle(item)} ${entityMeta(item)}`);
  // Every admin write clears the views built on it, including derived ones
  // like standings, leaderboards and squad counts.
  const entityFor: Record<LegacyResource, Parameters<typeof invalidateAfterWrite>[1]> = { teams: 'team', opponents: 'team', players: 'player', competitions: 'competition', matches: 'match', invites: 'invite' };
  // What each section is called when it confirms a write. Separate from
  // `entityFor` on purpose: a squad and an opposing club share a cache and a
  // table, but "Opponent created" is not "Squad created".
  const nounFor: Record<LegacyResource, ManageEntity> = { teams: 'team', opponents: 'opponent', players: 'player', competitions: 'competition', matches: 'match', invites: 'invite' };
  const invalidate = async () => { await invalidateAfterWrite(client, entityFor[resource]); };

  const save = form.handleSubmit(async (values) => {
    setFormError(null);
    /** A competition whose draw is still to be made keeps the form on itself. */
    let stayOn: Competition | null = null;
    /** A competition whose draw is done sends the admin to its standings. */
    let finished: Competition | null = null;
    try {
      if (resource === 'teams' || resource === 'opponents') {
        if (!values.name.trim()) throw new Error(resource === 'opponents' ? 'Enter the opposing club name.' : 'Enter a team or squad name.');
        const payload = { name: values.name.trim(), squad_code: values.code.trim() || null, age_group: values.ageGroup.trim() || null, season: values.season.trim() || null, is_aimz: resource === 'teams', is_active: true, competition_id: values.teamCompetitionId || null, competition_group_id: values.teamGroupId || null, coach: values.coach.trim() || null, assistant_coach: values.assistantCoach.trim() || null, badge_style: (values.badgeStyle || null) as BadgeStyle | null, logo_key: editing && 'logo_key' in editing ? editing.logo_key : null };
        editing ? await api.updateTeam(editing.id, payload) : await api.createTeam(payload);
      } else if (resource === 'competitions') {
        if (!values.name.trim() || !values.season.trim()) throw new Error('Enter a competition name and season.');
        // A knockout is a tournament with a draw shape; everything else has none.
        if (values.type === 'tournament' && !values.teamCount) throw new Error('Choose how many teams the knockout is drawn for.');
        const custom = values.teamCount === CUSTOM_DRAW;
        const groupCount = custom ? Number(values.groupCount) : Number(values.teamCount) / GROUP_SIZE;
        const groupSize = custom ? Number(values.groupSize) : GROUP_SIZE;
        const wrong = values.type === 'tournament' ? describeCustomDraw(groupCount, groupSize) : null;
        if (wrong) throw new Error(wrong);
        const payload = values.type === 'tournament'
          ? { name: values.name.trim(), season: values.season.trim(), type: values.type as Competition['type'], team_count: groupCount * groupSize, group_size: groupSize }
          : { name: values.name.trim(), season: values.season.trim(), type: values.type as Competition['type'], team_count: null, group_size: null };
        const saved = editing ? await api.updateCompetition(editing.id, payload) : await api.createCompetition(payload);
        // A knockout is only half set up when it saves: its groups exist but
        // stand empty, and the draw is made from this very form. Clearing back
        // to a blank one hid the section that does it, which read as the
        // feature not being there at all.
        if (saved.team_count && !editing) { stayOn = saved; setDrawnUp((current) => [...current, saved.id]); }
        // Saving it again is the admin saying the draw is done, so they are
        // taken to the table it produces.
        else if (saved.team_count) finished = saved;
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
        const invitePlayerIds = values.invitePlayerIds.split(',').filter(Boolean);
        // Every invitation names who it is for; there is no unlinked code.
        if (!invitePlayerIds.length) throw new Error(values.inviteKind === 'parent' ? 'Choose at least one child.' : 'Choose a player.');
        await api.createInvite({ label: values.label.trim(), code: values.code.trim(), kind: values.inviteKind as InviteKind, player_ids: invitePlayerIds });
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidate();
      if (stayOn) {
        setEditing(stayOn);
        form.reset({ ...defaults, name: stayOn.name, season: stayOn.season, type: stayOn.type, ...knockoutFormValues(stayOn) });
        // Not a plain confirmation: the competition is only half set up, and
        // this says what to do next rather than that the job is done.
        showToast('Groups drawn up — add teams below');
        return;
      }
      const wasEditing = editing;
      setEditing(null); form.reset(defaults);
      confirmManageSave(nounFor[resource], wasEditing);
      if (finished) {
        setDrawnUp((current) => current.filter((id) => id !== finished!.id));
        router.push({ pathname: '/(app)/(tabs)/standings', params: { competition: finished.id } });
      }
    } catch (error) { setFormError(error instanceof ApiError || error instanceof Error ? error.message : 'Could not save this item.'); }
  });

  const beginEdit = (item: Entity) => {
    setEditing(item); setFormError(null);
    pageRef.current?.scrollTo({ y: 0, animated: true });
    if ((resource === 'teams' || resource === 'opponents') && 'is_aimz' in item) form.reset({ ...defaults, name: item.name, code: item.squad_code ?? '', ageGroup: item.age_group ?? '', season: item.season ?? '', coach: item.coach ?? '', assistantCoach: item.assistant_coach ?? '', teamCompetitionId: item.competition_id ?? '', teamGroupId: item.competition_group_id ?? '', badgeStyle: item.badge_style ?? '' });
    if (resource === 'competitions' && 'type' in item && !('kickoff_datetime' in item)) form.reset({ ...defaults, name: item.name, season: item.season, type: item.type, ...knockoutFormValues(item) });
    if (resource === 'players' && 'position' in item) form.reset({ ...defaults, name: item.name, teamId: item.team_id, position: item.position, jersey: item.jersey_number?.toString() ?? '' });
    if (resource === 'matches' && 'kickoff_datetime' in item) form.reset({ ...defaults, competitionId: item.competition_id, homeTeamId: item.home_team_id, awayTeamId: item.away_team_id, kickoff: item.kickoff_datetime, venue: item.venue, status: item.status, halfLength: String(item.half_length_minutes ?? 45), numHalves: String(item.num_halves ?? 2), halfTimeBreak: String(item.half_time_break_minutes ?? 15), hasExtraTime: item.has_extra_time ? 'true' : 'false', extraTimeLength: String(item.extra_time_half_length_minutes ?? 15) });
  };

  const remove = (item: Entity) => {
    const label = entityTitle(item);
    const noun = resource === 'invites' ? 'Revoke' : 'Delete';
    confirmAction(`${noun} ${label}?`, 'This cannot be undone.', noun, async () => {
      try {
        if (resource === 'teams' || resource === 'opponents') await api.deleteTeam(item.id);
        if (resource === 'competitions') await api.deleteCompetition(item.id);
        if (resource === 'players') await api.deletePlayer(item.id);
        if (resource === 'matches') await api.deleteMatch(item.id);
        if (resource === 'invites') await api.revokeInvite(item.id);
        await invalidate();
        confirmManageWrite(nounFor[resource], 'deleted');
      } catch (error) {
        const problem = error as ApiError;
        // The API refuses to delete anything still referenced, so say what to do.
        showMessage(
          problem.status === 409 ? `${label} is still in use` : `Could not delete ${label}`,
          problem.status === 409
            ? 'Players, matches or results still reference it. Remove or reassign those first.'
            : problem.message,
        );
      }
    }, { destructive: true });
  };

  const uploadPhoto = async (item: Team | Player, entity: 'team' | 'player') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showMessage('Photo access needed', 'Allow photo access to upload a roster image.'); return; }
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
      confirmManageWrite('photo', 'saved');
    } catch (error) { showMessage('Upload failed', (error as Error).message); }
  };

  return <Screen scrollRef={pageRef} title="Manage Academy">
    {resourceChips}
    <View style={styles.content} testID="manage-content">
      {!appConfig.enableMedia && (resource === 'teams' || resource === 'players') ? <View style={styles.previewNote}><Text style={styles.previewNoteTitle}>Placeholder images only</Text><Text style={styles.previewNoteCopy}>Photo uploads are disabled in the free staging preview.</Text></View> : null}
      <View style={styles.formCard}><Text style={styles.heading}>{editing ? 'Edit' : 'Add'} {listLabel}</Text>{editing ? <View style={styles.editingBanner}><Text numberOfLines={1} style={styles.editingText}>Editing {entityTitle(editing)}</Text><AppButton compact label="Cancel" onPress={() => { setEditing(null); form.reset(defaults); setFormError(null); }} variant="ghost" /></View> : null}{formError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{formError}</Text> : null}<ResourceFields competitions={competitions.data?.items ?? []} control={form.control} editingId={editing && resource === 'competitions' ? editing.id : null} errors={form.formState.errors} players={players.data?.items ?? []} resource={resource} setValue={form.setValue} teams={teams.data?.items ?? []} /><View style={styles.actions}><AppButton label={editing ? 'Save changes' : 'Add item'} loading={form.formState.isSubmitting} onPress={save} style={styles.flexButton} />{editing ? <AppButton label="Cancel" onPress={() => { setEditing(null); form.reset(defaults); }} variant="ghost" /> : null}</View></View>
      {resource === 'players' ? <BulkPlayerImport teams={allTeams} /> : null}
      {resource === 'competitions' ? <SeasonControls competitions={competitions.data?.items ?? []} /> : null}
      {query.isError ? <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} /> : <CollapsibleSection count={items.length} search={{ label: `Search ${listLabel}`, onChange: setSearch, placeholder: `Search ${listLabel}…`, resultCount: shown.length, value: search }} title={`Current ${listLabel}`}>
      {query.isLoading ? <LoadingState /> : items.length === 0 ? <Text style={styles.empty}>Nothing has been added yet.</Text> : shown.length === 0 ? <Text style={styles.empty}>Nothing matches that.</Text> : <View style={styles.list}>{shown.map((item) => <View key={item.id} style={styles.item}><View style={styles.itemCopy}><Text style={styles.itemTitle}>{entityTitle(item)}</Text><Text style={styles.itemMeta}>{entityMeta(item)}</Text></View><View style={styles.rowActions}>{resource !== 'invites' ? <AppButton compact icon="pencil" iconOnly label="Edit" onPress={() => beginEdit(item)} variant="ghost" /> : null}{resource === 'matches' && 'kickoff_datetime' in item ? <AppButton compact icon={item.status === 'scheduled' ? 'play' : 'trophy'} iconOnly label={!item.home_team?.is_aimz && !item.away_team?.is_aimz ? (item.status === 'finished' ? 'Edit final score' : 'Enter final score') : (item.status === 'scheduled' ? 'Start' : 'Score')} onPress={() => router.push({ pathname: !item.home_team?.is_aimz && !item.away_team?.is_aimz ? '/result/[id]' : '/live/[id]', params: { id: item.id } })} variant="secondary" /> : null}{resource === 'players' ? <AppButton compact icon={<FamilyIcon color={colors.textPrimary} />} iconOnly label="Private roster details" onPress={() => router.push({ pathname: '/roster/[id]', params: { id: item.id } })} variant="secondary" /> : null}{appConfig.enableMedia && resource === 'teams' ? <AppButton compact icon="camera" iconOnly label="Photo" onPress={() => uploadPhoto(item as Team, 'team')} variant="secondary" /> : null}<AppButton compact icon="trash" iconOnly label={resource === 'invites' ? 'Revoke' : 'Delete'} onPress={() => remove(item)} variant="danger" /></View></View>)}</View>}
      </CollapsibleSection>}
      {/* An invitation says who an account will be; the accounts below say who
          took one up, and are where a link made against the wrong player is put
          right. */}
      {resource === 'invites' ? <AccountsSection players={players.data?.items ?? []} /> : null}
    </View>
  </Screen>;
}


/**
 * Who an invitation is for, which every invitation now names. A player
 * invitation is for one person; a parent may have several children here.
 * Both use the same searchable control, in single- and multi-select modes.
 */
function InvitePlayers({ control, players, setValue }: { control: any; players: Player[]; setValue: any }) {
  const kind = useWatch({ control, name: 'inviteKind' }) as InviteKind;
  const raw = (useWatch({ control, name: 'invitePlayerIds' }) as string) || '';
  const styles = useThemedStyles(stylesheet);
  const chosen = raw.split(',').filter(Boolean);
  const parent = kind === 'parent';
  return <>
    <PlayerPickerField
      label={parent ? 'Children' : 'Player'}
      onChange={(playerIds) => setValue('invitePlayerIds', playerIds.join(','))}
      placeholder={parent ? 'Choose children' : 'Choose a player'}
      players={players}
      selectedIds={chosen}
      selectionMode={parent ? 'multiple' : 'single'}
    />
    <Text style={styles.pickerNote}>{parent
      ? `${chosen.length ? `${chosen.length} child${chosen.length === 1 ? '' : 'ren'} selected. ` : ''}A parent account sees each child's stats, and the schedule and announcements of every squad they are on.`
      : 'A player invitation can be used once, and links the new account to this roster record.'}</Text>
  </>;
}

function ResourceFields({ control, resource, setValue, teams, competitions, editingId, players }: { control: any; errors: any; resource: LegacyResource; setValue: any; teams: Team[]; competitions: Competition[]; editingId: string | null; players: Player[] }) {
  const styles = useThemedStyles(stylesheet);
  const selectedCompetition = useWatch({ control, name: 'competitionId' }) as string;
  // Only teams entered in the chosen competition can play in it. Either side
  // can be ours or theirs; the label says which.
  const entered = teams.filter((item) => item.competition_id === selectedCompetition && item.is_active);
  const teamOptions = entered.map((item) => ({ label: `${item.name} · ${item.is_aimz ? 'AIMZ' : 'Opponent'}`, value: item.id }));
  const [homeTeamId, awayTeamId] = useWatch({ control, name: ['homeTeamId', 'awayTeamId'] }) as [string, string];
  const opponentOnly = Boolean(homeTeamId && awayTeamId && !teams.find((team) => team.id === homeTeamId)?.is_aimz && !teams.find((team) => team.id === awayTeamId)?.is_aimz);

  // A team picked before the competition changed may no longer be eligible.
  React.useEffect(() => {
    if (resource !== 'matches') return;
    const eligible = new Set(entered.map((item) => item.id));
    if (homeTeamId && !eligible.has(homeTeamId)) setValue('homeTeamId', '');
    if (awayTeamId && !eligible.has(awayTeamId)) setValue('awayTeamId', '');
  }, [resource, selectedCompetition, homeTeamId, awayTeamId, entered, setValue]);
  if (resource === 'opponents') return <><Controller control={control} name="name" render={({ field }) => <FormField hint="The opposing club, as it should read on a match" label="Opponent name" onChangeText={field.onChange} placeholder="Cairo Stars Women" value={field.value} />} /><Controller control={control} name="teamCompetitionId" render={({ field }) => <ChoiceField label="Competition (optional)" onChange={(value) => field.onChange(value)} options={[{ label: 'Not entered in a league', value: '' }, ...competitions.filter((item) => item.type !== 'friendly').map((item) => ({ label: `${item.name} · ${item.season}`, value: item.id }))]} placeholder="Choose a competition" value={field.value} />} /><TeamGroup competitions={competitions} control={control} /><BadgeChoice control={control} isAimz={false} /></>;
  if (resource === 'teams') return <><Controller control={control} name="name" render={({ field }) => <FormField label="Team or squad name" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="code" render={({ field }) => <FormField label="Squad code" onChangeText={field.onChange} placeholder="RTS S14" value={field.value} />} /><View style={styles.two}><Controller control={control} name="ageGroup" render={({ field }) => <FormField containerStyle={styles.flexButton} label="Age group" onChangeText={field.onChange} placeholder="U14" value={field.value} />} /><Controller control={control} name="season" render={({ field }) => <FormField containerStyle={styles.flexButton} label="Season" onChangeText={field.onChange} placeholder="2026/27" value={field.value} />} /></View><Controller control={control} name="teamCompetitionId" render={({ field }) => <ChoiceField label="Competition (optional)" onChange={(value) => field.onChange(value)} options={[{ label: 'Not entered in a league', value: '' }, ...competitions.filter((item) => item.type !== 'friendly').map((item) => ({ label: `${item.name} · ${item.season}`, value: item.id }))]} placeholder="Choose a competition" value={field.value} />} /><TeamGroup competitions={competitions} control={control} /><Controller control={control} name="coach" render={({ field }) => <FormField hint="Shown on the match lineup" label="Coach" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="assistantCoach" render={({ field }) => <FormField label="Assistant coach" onChangeText={field.onChange} value={field.value} />} /><BadgeChoice control={control} isAimz /></>;
  if (resource === 'competitions') return <><Controller control={control} name="name" render={({ field }) => <FormField label="Competition name" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="season" render={({ field }) => <FormField label="Season" onChangeText={field.onChange} placeholder="2026/27" value={field.value} />} /><Controller control={control} name="type" render={({ field }) => <ChoiceField label="Format" onChange={field.onChange} options={[{ label: 'League', value: 'league' }, { label: 'Knockout (groups and a bracket)', value: 'tournament' }, { label: 'Friendly', value: 'friendly' }]} value={field.value} />} /><KnockoutSize competitionId={editingId} control={control} teams={teams} /></>;
  if (resource === 'players') return <><Controller control={control} name="name" render={({ field }) => <FormField label="Player name" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="teamId" render={({ field }) => <ChoiceField label="Squad" onChange={field.onChange} options={teams.filter((item) => item.is_aimz && item.is_active).map((item) => ({ label: item.name, value: item.id }))} value={field.value} />} /><Controller control={control} name="position" render={({ field }) => <PositionField hint="Type the first letters — “l” finds LB, LWB, LM and LW" onChange={field.onChange} value={field.value} />} /><Controller control={control} name="jersey" render={({ field }) => <FormField keyboardType="number-pad" label="Number" onChangeText={field.onChange} value={field.value} />} /></>;
  if (resource === 'matches') return <><Controller control={control} name="competitionId" render={({ field }) => <ChoiceField label="Competition" onChange={field.onChange} options={competitions.map((item) => ({ label: `${item.name} · ${item.season}`, value: item.id }))} value={field.value} />} />{!selectedCompetition ? <Text style={styles.pickerNote}>Choose a competition to pick its teams.</Text> : entered.length < 2 ? <Text style={styles.pickerNote}>{entered.length === 0 ? 'No teams assigned to this competition yet' : 'Only one team is assigned to this competition'} — assign them under Squads or Opponents.</Text> : null}<Controller control={control} name="homeTeamId" render={({ field }) => <ChoiceField label="Home team" onChange={field.onChange} options={teamOptions} value={field.value} />} /><Controller control={control} name="awayTeamId" render={({ field }) => <ChoiceField label="Away team" onChange={field.onChange} options={teamOptions} value={field.value} />} /><Controller control={control} name="kickoff" render={({ field }) => <DateTimeField label="Kickoff (Egypt time)" onChange={field.onChange} value={field.value} />} />{opponentOnly ? <Text style={styles.pickerNote}>Opponent-only fixture: enter the final score after the match. Live clock, events, lineup and player stats are disabled.</Text> : <><Controller control={control} name="halfLength" render={({ field }) => <FormField hint="Minutes per half" inputMode="numeric" keyboardType="number-pad" label="Half length (minutes)" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="numHalves" render={({ field }) => <FormField hint="Two for standard football" inputMode="numeric" keyboardType="number-pad" label="Number of halves" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="halfTimeBreak" render={({ field }) => <FormField inputMode="numeric" keyboardType="number-pad" label="Half-time break (minutes)" onChangeText={field.onChange} value={field.value} />} /><Controller control={control} name="hasExtraTime" render={({ field }) => <ChoiceField label="Extra time" onChange={field.onChange} options={[{ label: 'No extra time', value: 'false' }, { label: `Yes, ${EXTRA_TIME_PERIODS} periods`, value: 'true' }]} value={field.value} />} /><ExtraTimeLength control={control} /><MatchLengthSummary control={control} /></>}<Controller control={control} name="venue" render={({ field }) => <FormField label="Venue" onChangeText={field.onChange} value={field.value} />} /></>;
  return <><Controller control={control} name="label" render={({ field }) => <FormField label="Invite label" onChangeText={field.onChange} placeholder="Autumn intake" value={field.value} />} /><Controller control={control} name="code" render={({ field }) => <FormField autoCapitalize="characters" label="Invite code" onChangeText={field.onChange} placeholder="AIMZ-2026" value={field.value} />} /><Controller control={control} name="inviteKind" render={({ field }) => <ChoiceField label="Invite type" onChange={(kind) => { field.onChange(kind); setValue('invitePlayerIds', ''); }} options={[{ label: 'Player', value: 'player' }, { label: 'Parent', value: 'parent' }]} value={field.value} />} /><InvitePlayers control={control} players={players} setValue={setValue} /></>;
}

function entityTitle(item: Entity) { if ('home_team_id' in item) return `${item.home_team?.name ?? 'Home'} vs ${item.away_team?.name ?? 'Away'}`; if ('position' in item) return item.name; if ('use_count' in item) return item.label; return item.name; }
/**
 * Which badge the team wears. Separate from the Squads/Opponents split, because
 * a league of peer clubs is all "ours" for players and lineups while none of
 * them should be wearing the AIMZ crest.
 */
function BadgeChoice({ control, isAimz }: { control: Control<Values>; isAimz: boolean }) {
  return <Controller control={control} name="badgeStyle" render={({ field }) => <ChoiceField
    label="Badge"
    onChange={field.onChange}
    options={[
      { label: isAimz ? 'AIMZ crest (default for a squad)' : 'Generated shield (default for a club)', value: '' },
      { label: 'AIMZ crest', value: 'aimz' },
      { label: 'Generated shield with initials', value: 'generated' },
    ]}
    value={field.value}
  />} />;
}

function entityMeta(item: Entity) { if ('home_team_id' in item) return `${item.status.toUpperCase()} · ${formatEgyptDateTime(item.kickoff_datetime)}`; if ('position' in item) return `${item.position} · #${item.jersey_number ?? '–'}`; if ('use_count' in item) { const who = item.players?.length ? item.players.map((player) => player.name).join(', ') : 'No one linked'; return `${item.kind === 'parent' ? 'Parent' : 'Player'} · ${who} · ${item.is_active ? 'Active' : 'Revoked'} · ${item.use_count} uses`; } if ('is_aimz' in item) return item.squad_code ?? (item.is_aimz ? [item.age_group, item.squad_code, item.season].filter(Boolean).join(' · ') || 'AIMZ squad' : 'Opponent club'); return `${item.type} · ${item.season}`; }

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ content: { gap: theme.spacing.lg }, groupList: { gap: theme.spacing.md }, groupsHeading: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '900' }, groupCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md }, groupHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, groupTitle: { color: colors.textPrimary, fontWeight: '900' }, groupCount: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800' }, groupCountFull: { color: colors.accentSoft }, groupTeam: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.sm, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between', minHeight: 44, paddingLeft: theme.spacing.md, paddingRight: theme.spacing.xs }, groupTeamName: { color: colors.textPrimary, flex: 1, fontWeight: '700' }, lockedField: { gap: theme.spacing.xs }, lockedLabel: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' }, lockedValue: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: colors.textMuted, minHeight: 52, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md }, pickerNote: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.md, color: colors.textSecondary, fontSize: theme.type.label, lineHeight: 20, padding: theme.spacing.md }, editingBanner: { alignItems: 'center', backgroundColor: colors.highlightedSurface, borderColor: colors.accent, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs }, editingText: { color: colors.textPrimary, flex: 1, fontWeight: '800' }, summary: { color: colors.accentSoft, fontSize: theme.type.label, fontWeight: '700', lineHeight: 20, marginTop: -theme.spacing.xs }, summaryInvalid: { color: colors.textMuted, fontSize: theme.type.label, lineHeight: 20, marginTop: -theme.spacing.xs }, /* The grid reaches past the page's own padding, for the width it buys the
     longest of the labels. */
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -theme.spacing.md }, chipCell: { flexBasis: '25%', flexShrink: 1, minWidth: 0, paddingBottom: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }, chip: { flex: 1, paddingVertical: theme.spacing.xs }, pressed: { opacity: 0.7 }, previewNote: { backgroundColor: colors.warningSurface, borderColor: colors.warning, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md }, previewNoteTitle: { color: colors.warningText, fontWeight: '900' }, previewNoteCopy: { color: colors.textPrimary, lineHeight: 22 }, formCard: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, error: { color: colors.errorText }, two: { flexDirection: 'row', gap: theme.spacing.sm }, /* The card gaps its fields by `md`; the extra `sm` sets the submit row apart from the last field. Kept in step with `formActions` on the hub managers. */ actions: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }, flexButton: { flex: 1 }, empty: { color: colors.textMuted, textAlign: 'center' }, list: { gap: theme.spacing.sm }, item: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md }, itemCopy: { flex: 1 }, itemTitle: { color: colors.textPrimary, fontWeight: '900' }, itemMeta: { color: colors.textMuted, marginTop: 4 }, rowActions: { flexDirection: 'row', flexShrink: 0, gap: theme.spacing.xs } });
