import { render } from '@testing-library/react-native';

import { DateSectionHeader } from '@/src/components/DateSectionHeader';

describe('DateSectionHeader', () => {
  it('shows only the match count for today', async () => {
    const screen = await render(<DateSectionHeader date={new Date('2026-08-27T12:00:00Z')} isToday matchCount={1} />);
    expect(screen.getByText('1 Match')).toBeTruthy();
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.queryByText(/Thursday/u)).toBeNull();
  });

  it('keeps the formatted date and plural count for other days', async () => {
    const screen = await render(<DateSectionHeader date={new Date('2026-08-21T12:00:00Z')} isToday={false} matchCount={7} />);
    expect(screen.getByText(/Friday/u)).toBeTruthy();
    expect(screen.getByText('7 Matches')).toBeTruthy();
  });
});
