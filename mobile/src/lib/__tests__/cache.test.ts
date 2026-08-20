import { QueryClient } from '@tanstack/react-query';

import { invalidateAfterWrite } from '@/src/lib/cache';

function trackInvalidations() {
  const client = new QueryClient();
  const seen: string[][] = [];
  jest.spyOn(client, 'invalidateQueries').mockImplementation(async (filters) => {
    seen.push([...((filters?.queryKey ?? []) as readonly string[])]);
  });
  return { client, keys: () => seen.map((key) => key.join('/')).sort() };
}

describe('invalidateAfterWrite', () => {
  it('clears the leaderboards and season totals when a goal is logged', async () => {
    const { client, keys } = trackInvalidations();
    await invalidateAfterWrite(client, 'event');
    // A goal moves the scoreline, the scorer charts and that player's totals.
    expect(keys()).toEqual(expect.arrayContaining(['leaders', 'matches', 'player-stats', 'standings', 'live-match']));
  });

  it('recalculates the table when a match changes', async () => {
    const { client, keys } = trackInvalidations();
    await invalidateAfterWrite(client, 'match');
    expect(keys()).toContain('standings');
    expect(keys()).toContain('matches');
  });

  it('refreshes squad counts when a player changes', async () => {
    const { client, keys } = trackInvalidations();
    await invalidateAfterWrite(client, 'player');
    // The Teams list counts players, so it reads from the players key.
    expect(keys()).toContain('players');
    expect(keys()).toContain('leaders');
  });

  it('reaches matches and standings when a team changes, since it is named there', async () => {
    const { client, keys } = trackInvalidations();
    await invalidateAfterWrite(client, 'team');
    expect(keys()).toEqual(expect.arrayContaining(['matches', 'players', 'standings', 'teams']));
  });

  it('offers a competition to the match form as soon as it exists', async () => {
    const { client, keys } = trackInvalidations();
    await invalidateAfterWrite(client, 'competition');
    expect(keys()).toContain('competitions');
    expect(keys()).toContain('matches');
  });

  it('does not invalidate the same key twice when several entities are written', async () => {
    const { client, keys } = trackInvalidations();
    await invalidateAfterWrite(client, 'match', 'event');
    const all = keys();
    expect(new Set(all).size).toBe(all.length);
  });
});
