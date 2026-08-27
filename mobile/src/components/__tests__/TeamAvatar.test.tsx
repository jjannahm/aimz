import { render } from '@testing-library/react-native';

import { initialsFor, TeamAvatar } from '@/src/components/TeamAvatar';
import { opponentBadgeColors } from '@/src/components/TeamBadge';

describe('initialsFor', () => {
  it('takes one letter from each of the first two words', () => {
    expect(initialsFor('AIMZ U18 Women')).toBe('AU');
    expect(initialsFor('Giza Lions')).toBe('GL');
  });

  it('falls back to the first two letters of a single word', () => {
    expect(initialsFor('Zamalek')).toBe('ZA');
  });

  it('survives padding and empty names', () => {
    expect(initialsFor('  Cairo   Stars  ')).toBe('CS');
    expect(initialsFor('   ')).toBe('?');
  });
});

describe('TeamAvatar', () => {
  // The badge is decorative: the team name is announced separately, so it is
  // hidden from assistive tech and queries must opt into hidden nodes.
  const hidden = { includeHiddenElements: true } as const;

  it('gives an AIMZ squad the club crest', async () => {
    const screen = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={48} />);
    expect(screen.getByTestId('badge-aimz', hidden)).toBeTruthy();
    expect(screen.getByTestId('aimz-shield', hidden)).toBeTruthy();
    expect(screen.getByTestId('crest-wordmark', hidden)).toBeTruthy();
  });

  it('keeps the complete crest at the size a standings row asks for', async () => {
    const row = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={34} />);
    expect(row.getAllByTestId('crest-stripe', hidden)).toHaveLength(6);
    expect(row.getByTestId('crest-wordmark', hidden)).toBeTruthy();
  });

  it('gives an opponent a named monogram shield, with no club wordmark', async () => {
    const screen = await render(<TeamAvatar name="Giza Lions" size={48} />);
    expect(screen.getByTestId('badge-opponent', hidden)).toBeTruthy();
    expect(screen.getByText('GL', hidden)).toBeTruthy();
    expect(screen.queryByTestId('crest-wordmark', hidden)).toBeNull();
  });

  it('keeps opponent colours deterministic and distinguishes different names', () => {
    expect(opponentBadgeColors('Giza Lions')).toEqual(opponentBadgeColors('  GIZA LIONS  '));
    expect(opponentBadgeColors('Giza Lions')).not.toEqual(opponentBadgeColors('Cairo Stars'));
  });

  it('lets a team wear a badge that its is_aimz flag would not have chosen', async () => {
    // A league of peer clubs is all "ours" for players and lineups, and none of
    // them should be wearing the club crest.
    const club = await render(<TeamAvatar badgeStyle="generated" isAimz name="Wadi Degla" size={48} />);
    expect(club.getByTestId('badge-opponent', hidden)).toBeTruthy();
    expect(club.getByText('WD', hidden)).toBeTruthy();
    expect(club.queryByTestId('badge-aimz', hidden)).toBeNull();

    const ours = await render(<TeamAvatar badgeStyle="aimz" name="Visiting Club" size={48} />);
    expect(ours.getByTestId('badge-aimz', hidden)).toBeTruthy();
  });

  it('falls back to is_aimz when no badge has been chosen', async () => {
    const unset = await render(<TeamAvatar badgeStyle={null} isAimz name="AIMZ U18 Women" size={48} />);
    expect(unset.getByTestId('badge-aimz', hidden)).toBeTruthy();
  });

  it('resolves a root-relative crest against the API host', async () => {
    const screen = await render(<TeamAvatar badgeStyle="generated" name="Al Ahly" size={48} />);
    expect(screen.getByTestId('badge-opponent', hidden)).toBeTruthy();
    const served = await render(<TeamAvatar logoUrl="/api/v1/media/teams/abc/crest.png" name="Al Ahly" size={48} />);
    expect(served.queryByTestId('badge-opponent', hidden)).toBeNull();
  });

  it('prefers an uploaded crest over the drawn badge', async () => {
    const screen = await render(<TeamAvatar isAimz logoUrl="https://example.test/crest.png" name="AIMZ U18 Women" />);
    expect(screen.queryByTestId('badge-aimz', hidden)).toBeNull();
    expect(screen.queryByTestId('badge-opponent', hidden)).toBeNull();
  });

  it('shows a crest whole rather than cropping it to a circle', async () => {
    // Club crests are shields and rarely square — Al Ahly's is 250x415. A round
    // frame with the default `cover` would cut it to a square and then clip the
    // corners off what was left.
    const screen = await render(<TeamAvatar logoUrl="https://example.test/al-ahly.webp" name="Al Ahly" size={34} />);
    const logo = screen.getByTestId('team-logo', hidden);
    expect(logo.props.resizeMode).toBe('contain');
    expect(logo.props.style).not.toEqual(expect.objectContaining({ borderRadius: expect.anything() }));
  });
});
