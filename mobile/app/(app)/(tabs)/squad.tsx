import { Screen } from '@/src/components/Screen';
import { EmptyState, LoadingState } from '@/src/components/StateView';
import { useMyTeamIds } from '@/src/lib/squad';

import { TeamProfile } from '../team/[id]';

/**
 * The coach's own squad, as a tab rather than a page opened over another.
 *
 * It renders the same profile the rest of the app opens from a fixture or a
 * table — details, record, fixtures, roster, and the league position where
 * there is a league — rather than a coach-shaped copy of it. Which squad it
 * is comes from the account, not from the URL, so there is nothing here to
 * point at somebody else's.
 */
export default function MySquadScreen() {
  const { teamIds, isLoading } = useMyTeamIds();

  if (isLoading) return <Screen hideSettings={false} title="Team"><LoadingState label="Loading your squad" /></Screen>;
  // A coach whose squads have not been assigned yet, which the API answers
  // with an empty list rather than an error.
  if (!teamIds?.length) {
    return <Screen title="Team">
      <EmptyState body="Ask an AIMZ administrator to assign your squad to your account." title="No squad yet" />
    </Screen>;
  }
  // Two squads is a coach taking two age groups, and the profile shows one at
  // a time. The first is the one they see; opening the other is a tap from any
  // of its fixtures.
  return <TeamProfile asTab id={teamIds[0]} />;
}
