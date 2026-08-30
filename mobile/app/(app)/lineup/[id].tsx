import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { CloseButton } from '@/src/components/CloseButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { showMessage } from '@/src/lib/platformAlert';
import { canStart, toggleStarter, type SquadShape } from '@/src/lib/lineupSelection';
import { byPosition, isGoalkeeper } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { FORMATIONS, LINEUP_FORMATS, type LineupFormat, type Player } from '@/src/types/api';

export default function LineupScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const matchQuery = useQuery({ queryKey: ['live-match', id], queryFn: () => api.live(id), enabled: Boolean(id) });
  const playersQuery = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const [format, setFormat] = useState<LineupFormat | null>(null);
  const [starters, setStarters] = useState<Set<string>>(new Set());
  const [formation, setFormation] = useState<string | null>(null);
  const [captain, setCaptain] = useState<string | null>(null);
  const match = matchQuery.data?.match;

  // Only AIMZ's own squad is managed here; the opponent is just a name.
  const squad = useMemo(() => {
    if (!match) return null;
    const candidates = [match.home_team, match.away_team].filter((team) => team?.is_aimz);
    return candidates[0] ?? match.home_team ?? match.away_team ?? null;
  }, [match]);
  // Read the way a team sheet is: keepers first, then out to the attack, and
  // alphabetical within each line.
  const roster = useMemo<Player[]>(
    () => byPosition(playersQuery.data?.items.filter((player) => player.team_id === squad?.id) ?? []),
    [playersQuery.data, squad],
  );

  // The squad's most recent finished match, as a lineup to copy forward.
  const previousQuery = useQuery({
    // `match_status` is the name both APIs accept; plain `status` is ignored by
    // FastAPI, which would quietly return unplayed matches too.
    queryKey: ['matches', 'previous', squad?.id],
    queryFn: () => api.matches(`?match_status=finished&team_id=${squad!.id}&limit=100`),
    enabled: Boolean(squad?.id),
  });
  const previousMatch = useMemo(() => {
    if (!squad) return null;
    const played = (previousQuery.data?.items ?? [])
      .filter((item) => item.id !== id && item.status === 'finished')
      .sort((a, b) => Date.parse(b.kickoff_datetime) - Date.parse(a.kickoff_datetime));
    return played[0] ?? null;
  }, [previousQuery.data, squad, id]);

  const [copying, setCopying] = useState(false);
  const copyLast = async () => {
    if (!previousMatch) return;
    setCopying(true);
    try {
      const snapshot = await api.live(previousMatch.id);
      // Players who have since left the squad are dropped, and the selection is
      // trimmed to whatever format this match is being played at.
      const eligible = snapshot.lineup
        .filter((entry) => entry.is_starter && roster.some((player) => player.id === entry.player_id))
        .map((entry) => entry.player_id);
      const nextFormat = (snapshot.match.lineup_format as LineupFormat | null) ?? format;
      if (nextFormat) setFormat(nextFormat);
      setFormation(nextFormat === snapshot.match.lineup_format ? snapshot.match.formation : null);
      setStarters(new Set(nextFormat ? eligible.slice(0, nextFormat) : eligible));
      const previousCaptain = snapshot.lineup.find((entry) => entry.is_captain)?.player_id ?? null;
      setCaptain(previousCaptain && eligible.includes(previousCaptain) ? previousCaptain : null);
      const dropped = snapshot.lineup.filter((entry) => entry.is_starter).length - eligible.length;
      showMessage('Lineup copied', dropped > 0
        ? `${dropped} player${dropped === 1 ? '' : 's'} from that lineup are no longer in the squad, so they were left out.`
        : 'Check it over, then save.');
    } catch (error) {
      showMessage('Could not copy that lineup', (error as ApiError).message);
    } finally {
      setCopying(false);
    }
  };

  // Pre-fill from whatever is already saved so an edit does not start blank.
  useEffect(() => {
    if (!matchQuery.data || format !== null) return;
    setFormat((match?.lineup_format as LineupFormat | null) ?? null);
    setFormation(match?.formation ?? null);
    setCaptain(matchQuery.data.lineup.find((entry) => entry.is_captain)?.player_id ?? null);
    const saved = matchQuery.data.lineup.filter((entry) => entry.is_starter).map((entry) => entry.player_id);
    if (saved.length) setStarters(new Set(saved));
  }, [matchQuery.data, match, format]);

  const save = useMutation({
    // Both writes belong to the save, so both run here. Patching the match from
    // `onSuccess` reported a failed format update as "Lineup not saved" even
    // though the entries were already stored, and swallowed the redirect with it.
    mutationFn: async () => {
      await api.lineup(id, roster.map((player) => ({
        player_id: player.id, team_id: player.team_id, is_starter: starters.has(player.id),
        is_captain: captain === player.id && starters.has(player.id),
        position: player.position, jersey_number: player.jersey_number,
      })));
      // The format lives on the match, so it is saved alongside the entries.
      if (match && format) {
        await api.updateMatch(id, {
          competition_id: match.competition_id, home_team_id: match.home_team_id,
          away_team_id: match.away_team_id, kickoff_datetime: match.kickoff_datetime,
          venue: match.venue, status: match.status, lineup_format: format, formation,
        });
      }
    },
    onSuccess: async () => {
      await invalidateAfterWrite(client, 'lineup', 'match');
      // Land on the match, where the lineup and pitch are, rather than wherever
      // the admin happened to come from.
      router.replace(`/match/${id}`);
    },
    // Name the fields the server actually rejected: a bare "check the
    // highlighted fields" says nothing when nothing on screen is highlighted.
    onError: (error) => {
      const failure = error as ApiError;
      const fields = failure.fields?.map((item) => `${item.field}: ${item.message}`).join('\n');
      showMessage('Lineup not saved', fields ? `${failure.message}\n\n${fields}` : failure.message);
    },
  });

  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;

  const bench = roster.filter((player) => !starters.has(player.id));
  const selected = starters.size;
  const complete = format !== null && selected === format;
  const byId = new Map(roster.map((player) => [player.id, player]));
  const keeperId = roster.find((player) => isGoalkeeper(player.position) && starters.has(player.id))?.id ?? null;
  // A squad with nobody who can go in goal is not held back for the want of
  // somebody who is not there.
  const shape: SquadShape = {
    format,
    positionOf: (playerId) => byId.get(playerId)?.position,
    hasKeepers: roster.some((player) => isGoalkeeper(player.position)),
  };
  const needsKeeper = shape.hasKeepers && keeperId === null;
  // The formation is what draws the pitch, so a lineup is not finished without it.
  const ready = complete && formation !== null && !needsKeeper;
  const locked = Boolean(match && match.status !== 'scheduled');

  const toggle = (playerId: string) => setStarters((current) => toggleStarter(current, playerId, shape));

  // The captain has to be on the pitch, so one who leaves the starters stops
  // being captain. Done here rather than inside the toggle, because a state
  // update belongs in an effect and not in another update's reducer.
  useEffect(() => {
    if (captain && !starters.has(captain)) setCaptain(null);
  }, [captain, starters]);

  return <Screen action={<CloseButton />} title="Set lineup">
    {matchQuery.isLoading || playersQuery.isLoading ? <LoadingState label="Loading squad" />
      : matchQuery.isError ? <ErrorState message={(matchQuery.error as ApiError).message} onRetry={() => matchQuery.refetch()} />
      : locked ? <EmptyState body="The starting lineup is locked once the match begins. Log a substitution from live scoring instead." title="Match already started" />
      : !roster.length ? <EmptyState body="Add players to this squad before setting a lineup." title="No squad players yet" />
      : <>
        {previousMatch ? <AppButton
          disabled={copying}
          icon="copy-outline"
          label={copying ? 'Copying…' : 'Copy last lineup'}
          onPress={copyLast}
          variant="secondary"
        /> : null}
        <ChoiceField label="Format" onChange={(value) => { const next = Number(value) as LineupFormat; setFormat(next); setFormation(null); setStarters((current) => new Set([...current].slice(0, next))); }} options={LINEUP_FORMATS.map((size) => ({ label: `${size}-a-side`, value: String(size) }))} placeholder="Choose a format" value={format === null ? undefined : String(format)} />
        {format === null ? <Text style={styles.hint}>Choose a format to pick the starting players.</Text> : <>
          <View style={styles.counterRow}>
            <Text accessibilityLiveRegion="polite" style={[styles.counter, complete && styles.counterDone]}>{selected} of {format} selected</Text>
            {complete ? <Ionicons color={colors.live} name="checkmark-circle" size={20} /> : null}
          </View>
          <Text style={styles.groupTitle}>Starting {format}</Text>
          {roster.map((player) => {
            const isStarter = starters.has(player.id);
            // Another keeper is never out of reach: it takes the standing
            // keeper's place rather than needing a slot of its own.
            const full = !canStart(starters, player.id, shape);
            return <Pressable accessibilityLabel={`${player.name}, ${player.position}`} accessibilityRole="checkbox" accessibilityState={{ checked: isStarter, disabled: full }} key={player.id} onPress={() => toggle(player.id)} style={({ pressed }) => [styles.row, isStarter && styles.rowActive, full && styles.rowFull, pressed && styles.pressed]}>
              <View style={[styles.check, isStarter && styles.checkOn]}>{isStarter ? <Ionicons color={colors.onAccent} name="checkmark" size={16} /> : null}</View>
              <View style={styles.copy}>
                <Text style={styles.name}>{player.name}</Text>
                <Text style={styles.meta}>{player.position}{player.jersey_number == null ? '' : ` · #${player.jersey_number}`}</Text>
              </View>
            </Pressable>;
          })}
          <Text style={styles.groupTitle}>Substitutes ({bench.length})</Text>
          <Text style={styles.hint}>{bench.length ? bench.map((player) => player.name).join(', ') : 'Everyone is starting.'}</Text>
          {complete ? <ChoiceField label="Formation" onChange={setFormation} options={FORMATIONS[format].map((shape) => ({ label: shape, value: shape }))} placeholder={`Shapes for ${format - 1} outfield players`} value={formation ?? undefined} /> : null}
          {complete ? <ChoiceField label="Captain (optional)" onChange={(value) => setCaptain(value || null)} options={[{ label: 'No captain', value: '' }, ...roster.filter((player) => starters.has(player.id)).map((player) => ({ label: `#${player.jersey_number ?? '–'} ${player.name}`, value: player.id }))]} placeholder="Choose a captain" value={captain ?? ''} /> : null}
          <AppButton disabled={!ready || save.isPending} label={save.isPending ? 'Saving…' : 'Save lineup'} onPress={() => save.mutate()} />
          {!complete ? <Text style={styles.hint}>Select exactly {format} starters to save.{needsKeeper ? ' One of them has to be a goalkeeper.' : ''}</Text> : needsKeeper ? <Text style={styles.hint}>Pick a goalkeeper to save.</Text> : !formation ? <Text style={styles.hint}>Choose a formation to save.</Text> : null}
        </>}
      </>}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ pressed: { opacity: 0.7 }, hint: { color: colors.textMuted, lineHeight: 20 }, counterRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm }, counter: { color: colors.accentSoft, fontSize: theme.type.body, fontWeight: '900' }, counterDone: { color: colors.liveText }, groupTitle: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900', marginTop: theme.spacing.sm }, row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 60, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, rowActive: { borderColor: colors.accent }, rowFull: { opacity: 0.45 }, check: { alignItems: 'center', borderColor: colors.border, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 }, checkOn: { backgroundColor: colors.accent, borderColor: colors.accent }, copy: { flex: 1 }, name: { color: colors.textPrimary, fontWeight: '800' }, meta: { color: colors.textMuted, marginTop: 2 } });
