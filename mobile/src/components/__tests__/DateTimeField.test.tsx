import { fireEvent, render } from '@testing-library/react-native';

import { DateTimeField } from '@/src/components/DateTimeField';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

// 5 September 2026, 18:30 in Egypt.
const VALUE = '2026-09-05T15:30:00.000Z';

async function open(onChange = jest.fn()) {
  const screen = await render(<DateTimeField label="Kickoff" onChange={onChange} value={VALUE} />);
  fireEvent.press(screen.getByLabelText('Kickoff'));
  await screen.findByText('Done');
  return { screen, onChange };
}

describe('DateTimeField', () => {
  it('shows Egypt local time, never an ISO string', async () => {
    const screen = await render(<DateTimeField label="Kickoff" onChange={jest.fn()} value={VALUE} />);
    expect(screen.getByText(formatEgyptDateTime(VALUE))).toBeTruthy();
    expect(screen.queryByText(/T\d\d:\d\d|Z$/u)).toBeNull();
  });

  it('keeps the panel closed until the field is pressed', async () => {
    const screen = await render(<DateTimeField label="Kickoff" onChange={jest.fn()} value={VALUE} />);
    expect(screen.queryByText('Done')).toBeNull();
    fireEvent.press(screen.getByLabelText('Kickoff'));
    expect(await screen.findByText('Done')).toBeTruthy();
  });

  it('stores the instant an Egypt day names', async () => {
    const { screen, onChange } = await open();
    fireEvent.press(screen.getByLabelText('7 September 2026'));
    // Still 18:30 Egypt, which is 15:30Z.
    expect(onChange).toHaveBeenCalledWith('2026-09-07T15:30:00.000Z');
  });

  it('moves the clock a quarter at a time without disturbing the day', async () => {
    const { screen, onChange } = await open();
    fireEvent.press(screen.getByLabelText('15 minutes later'));
    expect(onChange).toHaveBeenCalledWith('2026-09-05T15:45:00.000Z');
  });

  // Kickoffs are called on the quarter, so nothing else is reachable — and a
  // form opening on the current time arrives off it more often than not.
  it('pulls a time that is off the quarter onto the nearest one', async () => {
    const onChange = jest.fn();
    // 18:37 Egypt, which is 15:37Z.
    await render(<DateTimeField label="Kickoff" onChange={onChange} value="2026-09-05T15:37:00.000Z" />);
    expect(onChange).toHaveBeenCalledWith('2026-09-05T15:30:00.000Z');
  });

  it('rolls the hour when the quarters run out', async () => {
    const onChange = jest.fn();
    const screen = await render(<DateTimeField label="Kickoff" onChange={onChange} value="2026-09-05T15:45:00.000Z" />);
    fireEvent.press(screen.getByLabelText('Kickoff'));
    fireEvent.press(await screen.findByLabelText('15 minutes later'));
    expect(onChange).toHaveBeenCalledWith('2026-09-05T16:00:00.000Z');
  });

  it('wraps an hour backwards across midnight rather than changing nothing', async () => {
    const onChange = jest.fn();
    // 00:30 Egypt on 6 September.
    const screen = await render(<DateTimeField label="Kickoff" onChange={onChange} value="2026-09-05T21:30:00.000Z" />);
    fireEvent.press(screen.getByLabelText('Kickoff'));
    fireEvent.press(await screen.findByLabelText('Earlier hour'));
    expect(onChange).toHaveBeenCalledWith('2026-09-06T20:30:00.000Z');
  });

  it('browses months without selecting anything', async () => {
    const { screen, onChange } = await open();
    fireEvent.press(screen.getByLabelText('Next month'));
    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('acts as a date-only calendar without exposing time controls', async () => {
    const onChange = jest.fn();
    const screen = await render(<DateTimeField dateOnly label="Date of birth" onChange={onChange} value="2012-05-09" />);
    expect(screen.getByText('May 9, 2012')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Date of birth'));
    expect(screen.queryByText(/AM|PM/u)).toBeNull();
    fireEvent.press(await screen.findByLabelText('12 May 2012'));
    expect(onChange).toHaveBeenCalledWith('2012-05-12');
  });
});
