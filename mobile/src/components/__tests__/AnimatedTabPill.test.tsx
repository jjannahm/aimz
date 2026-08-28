import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet, Text, type ViewStyle } from 'react-native';

import { AnimatedTabPill, FadeThrough } from '@/src/components/AnimatedTabPill';
import { theme } from '@/src/theme';

type ReadableAnimatedValue = number | (Animated.Value & { __getValue: () => number });

function fillScale(node: { props: { style?: unknown } }) {
  const style = StyleSheet.flatten(node.props.style) as ViewStyle;
  return (style.transform?.[0] as { scaleY: ReadableAnimatedValue }).scaleY;
}

function currentValue(value: ReadableAnimatedValue) {
  return typeof value === 'number' ? value : value.__getValue();
}

describe('AnimatedTabPill', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('starts with the selected fill in place and exposes tab semantics', async () => {
    const screen = await render(<AnimatedTabPill label="Women U11" onPress={jest.fn()} selected testID="u11" />);
    const tab = screen.getByRole('tab', { name: 'Women U11' });

    expect(tab.props.accessibilityState.selected).toBe(true);
    expect(currentValue(fillScale(screen.getByTestId('u11-fill')))).toBe(1);
  });

  it('uses a full 240ms bottom-up transition when selection changes', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const screen = await render(<AnimatedTabPill label="Women U11" onPress={jest.fn()} selected testID="u11" />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    await screen.rerender(<AnimatedTabPill label="Women U11" onPress={jest.fn()} selected={false} testID="u11" />);

    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      duration: theme.motion.standard,
      toValue: 0,
      useNativeDriver: true,
    }));
    const fill = StyleSheet.flatten(screen.getByTestId('u11-fill').props.style) as ViewStyle;
    expect(fill.transformOrigin).toBe('bottom');
  });

  it('stops the previous animation when a rapid selection retargets it', async () => {
    const stop = jest.fn();
    const start = jest.fn();
    jest.spyOn(Animated, 'timing').mockReturnValue({ start, stop } as unknown as Animated.CompositeAnimation);
    const screen = await render(<AnimatedTabPill label="Opponents" onPress={jest.fn()} selected={false} />);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    await screen.rerender(<AnimatedTabPill label="Opponents" onPress={jest.fn()} selected />);
    await screen.rerender(<AnimatedTabPill label="Opponents" onPress={jest.fn()} selected={false} />);

    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalled();
  });

  it('snaps directly to the new state when reduced motion is enabled', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    const screen = await render(<AnimatedTabPill label="Players" onPress={jest.fn()} selected testID="players" />);

    await screen.rerender(<AnimatedTabPill label="Players" onPress={jest.fn()} selected={false} testID="players" />);

    expect(timing).not.toHaveBeenCalled();
    expect(currentValue(fillScale(screen.getByTestId('players-fill')))).toBe(0);
  });

  it('uses the full accessible label and invokes its press action', async () => {
    const onPress = jest.fn();
    const screen = await render(<AnimatedTabPill accessibilityLabel="Announcements" compact label="News" onPress={onPress} selected={false} />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Announcements' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('FadeThrough', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('fades old content out and new content in within the standard duration', async () => {
    const timing = jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
      start: (callback?: Parameters<Animated.CompositeAnimation['start']>[0]) => {
        (value as Animated.Value).setValue(Number(config.toValue));
        callback?.({ finished: true });
      },
      stop: jest.fn(),
    }) as unknown as Animated.CompositeAnimation);
    const screen = await render(<FadeThrough transitionKey="teams"><Text>Teams content</Text></FadeThrough>);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    await screen.rerender(<FadeThrough transitionKey="opponents"><Text>Opponents content</Text></FadeThrough>);

    expect(await screen.findByText('Opponents content')).toBeTruthy();
    expect(timing).toHaveBeenCalledTimes(2);
    for (const [, config] of timing.mock.calls) {
      expect(config).toEqual(expect.objectContaining({
        duration: theme.motion.standard / 2,
        useNativeDriver: true,
      }));
    }
  });

  it('brings the content back when the key returns before the fade finishes', async () => {
    // An animation that moves the value but never reports finishing, which is
    // what an in-flight fade looks like at the moment it is interrupted.
    jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
      start: () => { (value as Animated.Value).setValue(Number(config.toValue) === 0 ? 0.5 : 1); },
      stop: jest.fn(),
    }) as unknown as Animated.CompositeAnimation);
    const screen = await render(<FadeThrough testID="fade" transitionKey="a"><Text>A content</Text></FadeThrough>);
    await waitFor(() => expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled());

    await screen.rerender(<FadeThrough testID="fade" transitionKey="b"><Text>B content</Text></FadeThrough>);
    await screen.rerender(<FadeThrough testID="fade" transitionKey="a"><Text>A content</Text></FadeThrough>);

    // Nothing is left to fade it back in, so it must not be stranded part-way
    // out — a screen at low opacity reads as an empty one.
    const style = StyleSheet.flatten(screen.getByTestId('fade').props.style) as ViewStyle;
    expect(currentValue(style.opacity as ReadableAnimatedValue)).toBe(1);
    expect(screen.getByText('A content')).toBeTruthy();
  });

  it('switches content immediately when reduced motion is enabled', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    const screen = await render(<FadeThrough transitionKey="teams"><Text>Teams content</Text></FadeThrough>);

    await screen.rerender(<FadeThrough transitionKey="players"><Text>Players content</Text></FadeThrough>);

    expect(screen.getByText('Players content')).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();
  });
});
