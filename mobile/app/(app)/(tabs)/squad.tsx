import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { EmptyState, LoadingState } from '@/src/components/StateView';
import { SearchField } from '@/src/components/SearchField';
import { useMyTeamIds } from '@/src/lib/squad';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

import { Squad, TeamProfile } from '../team/[id]';

/** The two ways a coach reads her own squad: as one thing, or as its players. */
const HALVES = [
  { label: 'Team Stats', value: 'team' },
  { label: 'Player Stats', value: 'players' },
] as const;

/**
 * A coach's own squad, as a tab rather than a page opened over another.
 *
 * Both halves are screens the rest of the app already has. Team Stats is the
 * same profile anybody opens from a fixture or a table — record, form,
 * fixtures, league position — and Player Stats is the same roster with each
 * player's totals beside her shirt, opening the same player profile. Neither
 * is a coach-shaped copy of something.
 *
 * Which squad it is comes from the account rather than from the URL, so there
 * is nothing here to point at somebody else's.
 */
export default function MySquadScreen() {
  const { teamIds, isLoading } = useMyTeamIds();
  const [half, setHalf] = React.useState<'team' | 'players'>('team');
  const [searching, setSearching] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [resultCount, setResultCount] = React.useState<number | undefined>();
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const toggleSearch = () => {
    setSearching((current) => {
      if (current) setSearch('');
      return !current;
    });
  };
  const searchButton = half === 'players' ? <Pressable accessibilityLabel={searching ? 'Close player search' : 'Search players'} accessibilityRole="button" accessibilityState={{ expanded: searching }} onPress={toggleSearch} style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}><Ionicons accessibilityElementsHidden color={searching ? colors.accentSoft : colors.textPrimary} name={searching ? 'close' : 'search'} size={22} /></Pressable> : null;
  const tabs = <SegmentedControl label="Which statistics" onChange={setHalf} options={HALVES} value={half} />;

  if (isLoading) return <Screen title="My Team"><LoadingState label="Loading your squad" /></Screen>;
  // A coach whose squads have not been assigned yet, which the API answers
  // with an empty list rather than an error.
  if (!teamIds?.length) {
    return <Screen title="My Team">
      <EmptyState body="Ask an AIMZ administrator to assign your squad to your account." title="No squad yet" />
    </Screen>;
  }

  // Two squads is a coach taking two age groups, and both halves show one at a
  // time. The first is the one she sees; opening the other is a tap from any
  // of its fixtures.
  const teamId = teamIds[0]!;
  if (half === 'players') {
    return <Screen title="My Team" utility={searchButton}>
      {tabs}
      {searching ? <SearchField autoFocus label="Search players" onChange={setSearch} placeholder="Search a name, position or number…" resultCount={resultCount} value={search} /> : null}
      <Squad onResultCount={setResultCount} search={search} teamId={teamId} />
    </Screen>;
  }
  return <TeamProfile above={tabs} asTab id={teamId} title="My Team" />;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  searchButton: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 22, height: theme.touch.minimum, justifyContent: 'center', width: theme.touch.minimum },
  pressed: { opacity: 0.7 },
});
