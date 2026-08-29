import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CloseButton } from '@/src/components/CloseButton';
import { HonoursSection } from '@/src/components/player/HonoursSection';
import { MilestonesSection } from '@/src/components/player/MilestonesSection';
import { PlayerStatsPanel } from '@/src/components/PlayerStatsPanel';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { api } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/** Every season, plus the career that spans them. */
const ALL_SEASONS = '';

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useThemedStyles(stylesheet);
  const [season, setSeason] = React.useState<string>(ALL_SEASONS);
  // The unfiltered read, which is what knows every season she has played in, so
  // the switcher does not lose its own options once a season is chosen. Keyed
  // the way the panel keys an unfiltered read, so "Career" is one shared fetch.
  const career = useQuery({ queryKey: ['player-stats', id, null], queryFn: () => api.playerStats(id), enabled: Boolean(id) });
  const seasons = career.data?.seasons ?? [];

  if (!id) return <Screen action={<CloseButton />} title="Player" />;

  return <Screen action={<CloseButton />} title="Player stats">
    {seasons.length > 1 ? <SegmentedControl
      label="Which season to show"
      onChange={setSeason}
      options={[{ label: 'Career', value: ALL_SEASONS }, ...seasons.map((item) => ({ label: item, value: item }))]}
      value={season}
    /> : null}
    <PlayerStatsPanel playerId={id} season={season || undefined} />
    <MilestonesSection milestones={career.data?.milestones ?? { reached: [], streaks: [], next: [] }} />
    <HonoursSection playerId={id} />
    {career.isSuccess && !career.data.matches.length
      ? <View style={styles.note}><Text style={styles.noteText}>Milestones and honours appear once she has played a match.</Text></View>
      : null}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  note: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.md, padding: theme.spacing.md },
  noteText: { color: colors.textSecondary, lineHeight: 22 },
});
