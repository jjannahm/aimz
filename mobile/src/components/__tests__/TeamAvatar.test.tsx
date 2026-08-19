import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { initialsFor, TeamAvatar } from '@/src/components/TeamAvatar';
import { theme } from '@/src/theme';

const backgroundOf = (element: { props: Record<string, unknown> } | null) =>
  (StyleSheet.flatten(element?.props.style as never) as { backgroundColor?: string } | undefined)?.backgroundColor;

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
  // The circle is decorative: the team name is announced separately, so the
  // avatar is hidden from assistive tech and queries must opt into hidden nodes.
  it('shows initials when the team has no crest', async () => {
    const screen = await render(<TeamAvatar name="AIMZ U18 Women" />);
    expect(screen.getByText('AU', { includeHiddenElements: true })).toBeTruthy();
  });

  it('gives a team the same colour everywhere it appears', async () => {
    const first = await render(<TeamAvatar name="Giza Lions" />);
    const second = await render(<TeamAvatar name="Giza Lions" />);
    const colour = backgroundOf(first.getByText('GL', { includeHiddenElements: true }).parent!);
    expect(colour).toBe(backgroundOf(second.getByText('GL', { includeHiddenElements: true }).parent!));
    expect([theme.colors.accent, theme.colors.lightBlue]).toContain(colour);
  });

  it('lets a caller pin the tone, so home and away stay distinct', async () => {
    const home = await render(<TeamAvatar name="Same Name" tone="accent" />);
    const away = await render(<TeamAvatar name="Same Name" tone="light" />);
    expect(backgroundOf(home.getByText('SN', { includeHiddenElements: true }).parent!)).toBe(theme.colors.accent);
    expect(backgroundOf(away.getByText('SN', { includeHiddenElements: true }).parent!)).toBe(theme.colors.lightBlue);
  });
});
