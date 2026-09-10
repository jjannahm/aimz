import React from 'react';

import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { EmptyState, LoadingState } from '@/src/components/StateView';
import { useMyTeamIds } from '@/src/lib/squad';

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
    return <Screen title="My Team">
      {tabs}
      <Squad teamId={teamId} />
    </Screen>;
  }
  return <TeamProfile above={tabs} asTab id={teamId} title="My Team" />;
}
