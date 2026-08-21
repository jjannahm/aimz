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
  const match = matchQuery.data?.match;

  // Only AIMZ's own squad is managed here; the opponent is just a name.
  const squad = useMemo(() => {
    if (!match) return null;
    const candidates = [match.home_team, match.away_team].filter((team) => team?.is_aimz);
    return candidates[0] ?? match.home_team ?? match.away_team ?? null;
  }, [match]);
  const roster = useMemo<Player[]>(
    () => playersQuery.data?.items.filter((player) => player.team_id === squad?.id) ?? [],
    [playersQuery.data, squad],
  );

  // Pre-fill from whatever is already saved so an edit does not start blank.
  useEffect(() => {
    if (!matchQuery.data || format !== null) return;
    setFormat((match?.lineup_format as LineupFormat | null) ?? null);
    setFormation(match?.formation ?? null);
    const saved = matchQuery.data.lineup.filter((entry) => entry.is_starter).map((entry) => entry.player_id);
    if (saved.length) setStarters(new Set(saved));
  }, [matchQuery.data, match, format]);

  const save = useMutation({
    mutationFn: () => api.lineup(id, roster.map((player) => ({
      player_id: player.id, team_id: player.team_id, is_starter: starters.has(player.id),
      position: player.position, jersey_number: player.jersey_number,
    }))),
    onSuccess: async () => {
      // The format lives on the match, so it is saved alongside the entries.
      if (match && format) {
        await api.updateMatch(id, {
          competition_id: match.competition_id, home_team_id: match.home_team_id,
          away_team_id: match.away_team_id, kickoff_datetime: match.kickoff_datetime,
          venue: match.venue, status: match.status, lineup_format: format, formation,
        });
      }
      await invalidateAfterWrite(client, 'lineup', 'match');
      router.back();
    },
    onError: (error) => showMessage('Lineup not saved', (error as ApiError).message),
  });

  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;

  const bench = roster.filter((player) => !starters.has(player.id));
  const selected = starters.size;
  const complete = format !== null && selected === format;
  // The formation is what draws the pitch, so a lineup is not finished without it.
  const ready = complete && formation !== null;
  const locked = Boolean(match && match.status !== 'scheduled');

  const toggle = (playerId: string) => setStarters((current) => {
    const next = new Set(current);
    if (next.has(playerId)) next.delete(playerId);
    else if (format === null || next.size < format) next.add(playerId);
    else return current; // Full: deselect someone first rather than silently swapping.
    return next;
  });

  return <Screen action={<CloseButton />} eyebrow={squad?.name ?? 'AIMZ squad'} title="Set lineup">
    {matchQuery.isLoading || playersQuery.isLoading ? <LoadingState label="Loading squad" />
      : matchQuery.isError ? <ErrorState message={(matchQuery.error as ApiError).message} onRetry={() => matchQuery.refetch()} />
      : locked ? <EmptyState body="The starting lineup is locked once the match begins. Log a substitution from live scoring instead." title="Match already started" />
      : !roster.length ? <EmptyState body="Add players to this squad before setting a lineup." title="No squad players yet" />
      : <>
        <ChoiceField label="Format" onChange={(value) => { const next = Number(value) as LineupFormat; setFormat(next); setFormation(null); setStarters((current) => new Set([...current].slice(0, next))); }} options={LINEUP_FORMATS.map((size) => ({ label: `${size}-a-side`, value: String(size) }))} placeholder="Choose a format" value={format === null ? undefined : String(format)} />
        {format === null ? <Text style={styles.hint}>Choose a format to pick the starting players.</Text> : <>
          <View style={styles.counterRow}>
            <Text accessibilityLiveRegion="polite" style={[styles.counter, complete && styles.counterDone]}>{selected} of {format} selected</Text>
            {complete ? <Ionicons color={colors.live} name="checkmark-circle" size={20} /> : null}
          </View>
          <Text style={styles.groupTitle}>Starting {format}</Text>
          {roster.map((player) => {
            const isStarter = starters.has(player.id);
            const full = !isStarter && selected >= format;
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
          <AppButton disabled={!ready || save.isPending} label={save.isPending ? 'Saving…' : 'Save lineup'} onPress={() => save.mutate()} />
          {!complete ? <Text style={styles.hint}>Select exactly {format} starters to save.</Text> : !formation ? <Text style={styles.hint}>Choose a formation to save.</Text> : null}
        </>}
      </>}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ pressed: { opacity: 0.7 }, hint: { color: colors.textMuted, lineHeight: 20 }, counterRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm }, counter: { color: colors.accentSoft, fontSize: theme.type.body, fontWeight: '900' }, counterDone: { color: colors.liveText }, groupTitle: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900', marginTop: theme.spacing.sm }, row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 60, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, rowActive: { borderColor: colors.accent }, rowFull: { opacity: 0.45 }, check: { alignItems: 'center', borderColor: colors.border, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 }, checkOn: { backgroundColor: colors.accent, borderColor: colors.accent }, copy: { flex: 1 }, name: { color: colors.textPrimary, fontWeight: '800' }, meta: { color: colors.textMuted, marginTop: 2 } });
