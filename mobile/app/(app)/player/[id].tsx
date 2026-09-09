import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CloseButton } from '@/src/components/CloseButton';
import { HonoursSection } from '@/src/components/player/HonoursSection';
import { MilestonesSection } from '@/src/components/player/MilestonesSection';
import { PlayerStatsPanel } from '@/src/components/PlayerStatsPanel';
import { Screen } from '@/src/components/Screen';
import { ALL_SEASONS, SeasonFilter, seasonQuery } from '@/src/components/SeasonFilter';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { TrainingStatsPanel } from '@/src/components/TrainingStatsPanel';
import { api } from '@/src/lib/api';
import { useSquadPlaysMatches } from '@/src/lib/squad';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

const MATCH = { label: 'Match Stats', value: 'match' } as const;
const TRAINING = { label: 'Training Stats', value: 'training' } as const;
type Half = 'match' | 'training';

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useThemedStyles(stylesheet);
  const [season, setSeason] = React.useState<string>(ALL_SEASONS);
  // Opens on training, the same half My Stats opens on: a coach reading somebody
  // else's record and a family reading their own are looking at one thing.
  const [half, setHalf] = React.useState<Half>('training');
  // The unfiltered read, which is what knows every season she has played in, so
  // the switcher does not lose its own options once a season is chosen. Keyed
  // the way the panel keys an unfiltered read, so "Career" is one shared fetch.
  const career = useQuery({ queryKey: ['player-stats', id, null], queryFn: () => api.playerStats(id), enabled: Boolean(id) });
  const seasons = career.data?.seasons ?? [];
  const plays = useSquadPlaysMatches(career.data?.player.team_id);
  const showing: Half = plays ? half : 'training';

  if (!id) return <Screen action={<CloseButton />} title="Player" />;

  // Her name heads the page rather than the word "Player stats". The match
  // panel used to be the only thing on here that named her, which left the
  // training half — the half this opens on now — with nobody's name on it.
  return <Screen action={<CloseButton />} title={career.data?.player.name ?? 'Player stats'}>
    {plays ? <SegmentedControl label="Which statistics" onChange={setHalf} options={[MATCH, TRAINING]} value={showing} /> : null}

    {showing === 'match' ? <>
      <SeasonFilter onChange={setSeason} seasons={seasons} value={seasons.includes(season) ? season : ALL_SEASONS} />
      <PlayerStatsPanel playerId={id} season={seasonQuery(season, seasons)} />
      <MilestonesSection milestones={career.data?.milestones ?? { reached: [], streaks: [], next: [] }} />
      <HonoursSection playerId={id} />
      {career.isSuccess && !career.data.matches.length
        ? <View style={styles.note}><Text style={styles.noteText}>Milestones and honours appear once she has played a match.</Text></View>
        : null}
    </> : <>
      {/* Said once, for a squad that plays nobody: otherwise a reader wonders
        * where the match half went. */}
      {plays ? null : <View style={styles.note}><Text style={styles.noteText}>This squad is not entered in a competition, so there are no match statistics to show.</Text></View>}
      <TrainingStatsPanel playerId={id} />
    </>}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  note: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.md, padding: theme.spacing.md },
  noteText: { color: colors.textSecondary, lineHeight: 22 },
});
