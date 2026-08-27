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

  it('prefers an uploaded crest over the drawn badge', async () => {
    const screen = await render(<TeamAvatar isAimz logoUrl="https://example.test/crest.png" name="AIMZ U18 Women" />);
    expect(screen.queryByTestId('badge-aimz', hidden)).toBeNull();
    expect(screen.queryByTestId('badge-opponent', hidden)).toBeNull();
  });
});
