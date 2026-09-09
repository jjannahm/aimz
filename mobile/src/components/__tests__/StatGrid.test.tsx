import { render } from '@testing-library/react-native';

import { StatGrid } from '@/src/components/StatGrid';

describe('the shared figure grid', () => {
  it('draws a figure and its label, and nothing else', async () => {
    const screen = await render(<StatGrid stats={[{ key: 'goals', label: 'Goals', value: 12 }]} />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Goals')).toBeTruthy();
  });

  /**
   * The match half shares this grid and passes no notes, so the third line has
   * to stay out of its way rather than leave a gap under every figure.
   */
  it('adds a third line only where a figure carries a note', async () => {
    const screen = await render(<StatGrid stats={[
      { key: 'mine', label: 'Attendance', value: '80%' },
      { key: 'squad', label: 'Team average', value: '60%', note: 'Above average', noteTone: '#22C55E' },
    ]} />);

    expect(screen.getByText('Above average').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#22C55E' })]),
    );
    // One note between two tiles, not one apiece.
    expect(screen.queryAllByText(/average$/u)).toHaveLength(2);
  });

  it('draws nothing at all when there are no figures', async () => {
    const screen = await render(<StatGrid stats={[]} />);
    expect(screen.toJSON()).toBeNull();
  });
});
