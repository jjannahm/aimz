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
  });

  it('gives an opponent the neutral shield, with no club wordmark', async () => {
    const screen = await render(<TeamAvatar name="Giza Lions" size={48} />);
    expect(screen.getByTestId('badge-opponent', hidden)).toBeTruthy();
    expect(screen.queryByText('aimz', hidden)).toBeNull();
  });

  // The drawn crest lost its stripes and wordmark below forty points; the
  // artwork carries its own detail and holds together at any size.
  it('wears the same crest in a table row as in a squad list', async () => {
    const large = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={48} />);
    const small = await render(<TeamAvatar isAimz name="AIMZ U18 Women" size={34} />);
    expect(large.getByTestId('badge-aimz', hidden)).toBeTruthy();
    expect(small.getByTestId('badge-aimz', hidden)).toBeTruthy();
  });

  it('prefers an uploaded crest over the drawn badge', async () => {
    const screen = await render(<TeamAvatar isAimz logoUrl="https://example.test/crest.png" name="AIMZ U18 Women" />);
    expect(screen.queryByTestId('badge-aimz', hidden)).toBeNull();
    expect(screen.queryByTestId('badge-opponent', hidden)).toBeNull();
  });
});
