import { render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { MatchProgressRail, MatchStatusIndicator } from '@/src/components/MatchStatusIndicator';
import { getMatchClockState } from '@/src/lib/matchClock';

const now = Date.parse('2026-08-20T12:00:00.000Z');

describe('MatchStatusIndicator', () => {
  it('shows a live dot and moving clock during active play', async () => {
    const clock = getMatchClockState({ status: 'live', phase: 'first_half', phase_started_at: '2026-08-20T11:37:30.000Z' }, now);
    const screen = await render(<MatchStatusIndicator clock={clock} />);
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByText('22:30')).toBeTruthy();
    expect(screen.getByTestId('live-dot')).toBeTruthy();
  });

  it('replaces the timer and dot with halftime', async () => {
    const clock = getMatchClockState({ status: 'live', phase: 'halftime', phase_started_at: null }, now);
    const screen = await render(<MatchStatusIndicator clock={clock} />);
    expect(screen.getByText('HALFTIME')).toBeTruthy();
    expect(screen.queryByTestId('live-dot')).toBeNull();
  });

  it('labels extra time and fills its dedicated progress segment', async () => {
    const clock = getMatchClockState({ status: 'live', phase: 'extra_time', phase_started_at: '2026-08-20T11:45:00.000Z' }, now);
    const status = await render(<MatchStatusIndicator clock={clock} />);
    expect(status.getByText('EXTRA TIME')).toBeTruthy();
    expect(status.getByText('105:00')).toBeTruthy();
    expect(status.getByTestId('live-dot')).toBeTruthy();
    const progress = await render(<MatchProgressRail clock={clock} />);
    expect(progress.getByTestId('extra-time-progress')).toHaveStyle({ width: '50%' });
  });

  it('keeps the live dot static when reduced motion is enabled', async () => {
    const reducedMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true);
    const loop = jest.spyOn(Animated, 'loop');
    loop.mockClear();
    const clock = getMatchClockState({ status: 'live', phase: 'first_half', phase_started_at: '2026-08-20T11:59:30.000Z' }, now);
    const screen = await render(<MatchStatusIndicator clock={clock} />);
    expect(screen.getByTestId('live-dot')).toBeTruthy();
    expect(reducedMotion).toHaveBeenCalled();
    expect(loop).not.toHaveBeenCalled();
    reducedMotion.mockRestore();
    loop.mockRestore();
  });
});
