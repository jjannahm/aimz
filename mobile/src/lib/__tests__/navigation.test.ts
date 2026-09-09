import { tabsForRole } from '@/src/lib/navigation';

/** The titles actually drawn on the bar, in the order they appear. */
const bar = (role: Parameters<typeof tabsForRole>[0], hasCompetition = false) =>
  tabsForRole(role, hasCompetition).filter((tab) => tab.onBar).map((tab) => tab.title);

describe('tabsForRole', () => {
  it('gives a manager exactly Matches, Team and Manage', () => {
    expect(bar('manager')).toEqual(['Matches', 'Team', 'Manage']);
    // A league does not add a fourth: their table is inside the Team tab.
    expect(bar('manager', true)).toEqual(['Matches', 'Team', 'Manage']);
  });

  it('keeps the academy bar for an administrator', () => {
    expect(bar('admin')).toEqual(['Matches', 'Standings', 'Players', 'Manage']);
  });

  it('leaves Standings off a squad that is in no competition', () => {
    expect(bar('player')).toEqual(['Matches', 'Players', 'Hub']);
    expect(bar('parent')).toEqual(['Matches', 'Players', 'Hub']);
  });

  it('gives Standings back once the squad is entered in one', () => {
    expect(bar('player', true)).toEqual(['Matches', 'Standings', 'Players', 'Hub']);
  });

  it('never gives a family Manage or the manager Team tab', () => {
    for (const role of ['player', 'parent'] as const) {
      expect(bar(role, true)).not.toContain('Manage');
      expect(bar(role, true)).not.toContain('Team');
    }
  });

  it('registers every route whatever the role', () => {
    // A tab leaves the bar by having no href; the route stays so a deep link
    // to it still resolves.
    const names = ['index', 'standings', 'players', 'squad', 'my-team', 'manage', 'settings'];
    for (const role of ['admin', 'manager', 'player', 'parent', undefined] as const) {
      expect(tabsForRole(role, false).map((tab) => tab.name)).toEqual(names);
    }
  });

  it('shows a signed-out shell nothing it cannot open', () => {
    // Before the session resolves there is no role, and the bar must not offer
    // Manage on the chance that one arrives.
    expect(bar(undefined)).not.toContain('Manage');
  });
});
