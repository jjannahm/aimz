import { render } from '@testing-library/react-native';

import { initialsFor, TeamAvatar } from '@/src/components/TeamAvatar';

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
    expect(screen.getByText('aimz', hidden)).toBeTruthy();
  });

  // A standings row asks for 34, which is under the size the wordmark needs.
  // The stripes are what say whose crest it is, so they stay: without them an
  // AIMZ row wore a bare shield, which is what an opponent wears.
  it('keeps the stripes at the size a standings row asks for', async () => {
    const row = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={34} />);
    expect(row.getAllByTestId('crest-stripe', hidden)).toHaveLength(6);
    expect(row.queryByText('aimz', hidden)).toBeNull();
  });

  it('gives an opponent the neutral shield, with no club wordmark', async () => {
    const screen = await render(<TeamAvatar name="Giza Lions" size={48} />);
    expect(screen.getByTestId('badge-opponent', hidden)).toBeTruthy();
    expect(screen.queryByText('aimz', hidden)).toBeNull();
  });

  it('drops the crest detail at table-row size, where it would be unreadable', async () => {
    const large = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={48} />);
    const small = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={34} />);
    expect(large.getByText('aimz', hidden)).toBeTruthy();
    // Still the crest, just without the stripes and wordmark.
    expect(small.getByTestId('badge-aimz', hidden)).toBeTruthy();
    expect(small.queryByText('aimz', hidden)).toBeNull();
  });

  it('prefers an uploaded crest over the drawn badge', async () => {
    const screen = await render(<TeamAvatar isAimz logoUrl="https://example.test/crest.png" name="AIMZ U18 Women" />);
    expect(screen.queryByTestId('badge-aimz', hidden)).toBeNull();
    expect(screen.queryByTestId('badge-opponent', hidden)).toBeNull();
  });
});
