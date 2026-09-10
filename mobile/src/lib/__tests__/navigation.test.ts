import { tabsForRole } from '@/src/lib/navigation';

/** The titles actually drawn on the dock, in the order they appear. */
const dock = (role: Parameters<typeof tabsForRole>[0]) =>
  tabsForRole(role).filter((tab) => tab.onBar).map((tab) => tab.title);

describe('tabsForRole', () => {
  it('gives a coach exactly Matches, Team and Manage, in that order', () => {
    expect(dock('coach')).toEqual(['Manage', 'Team', 'Matches']);
  });

  it('keeps the academy dock for an administrator', () => {
    // The squads come before the fixtures, and are called Teams: running the
    // academy starts with who is in it, and none of them is the admin's own.
    expect(dock('admin')).toEqual(['Manage', 'Teams', 'Matches']);
  });

  it('calls the squads My Team for a family and Teams for an administrator', () => {
    // The same route, named for whoever is reading it.
    expect(dock('player')).toContain('My Team');
    expect(dock('admin')).toContain('Teams');
    expect(dock('admin')).not.toContain('My Team');
  });

  it('puts the family week at the thumb end', () => {
    // Read from the right: Hub, Reports, My Team, then the academy's fixtures
    // furthest away.
    expect(dock('player')).toEqual(['Matches', 'My Team', 'Reports', 'Hub']);
    expect(dock('parent')).toEqual(['Matches', 'My Team', 'Reports', 'Hub']);
  });

  it('never gives a family Manage, or anybody else the Team tab', () => {
    for (const role of ['player', 'parent'] as const) expect(dock(role)).not.toContain('Manage');
    for (const role of ['player', 'parent', 'admin'] as const) expect(dock(role)).not.toContain('Team');
  });

  it('never gives a coach the academy-wide tabs', () => {
    for (const title of ['My Team', 'Teams', 'Hub', 'Reports']) expect(dock('coach')).not.toContain(title);
  });

  it('registers every route whatever the role', () => {
    // A tab leaves the dock by having no href; the route stays so a deep link
    // to it still resolves.
    // Every role registers the same routes; only their order and their
    // wording differ, and an administrator reads the squads before the
    // fixtures.
    for (const role of ['coach', 'player', 'parent', undefined] as const) {
      expect(tabsForRole(role).map((tab) => tab.name)).toEqual(['manage', 'squad', 'index', 'players', 'reports', 'my-team', 'settings']);
    }
    expect(tabsForRole('admin').map((tab) => tab.name)).toEqual(['manage', 'squad', 'players', 'index', 'reports', 'my-team', 'settings']);
  });

  it('shows a signed-out shell nothing it cannot open', () => {
    // Before the session resolves there is no role, and the dock must not
    // offer Manage on the chance that one arrives.
    expect(dock(undefined)).not.toContain('Manage');
  });
});
