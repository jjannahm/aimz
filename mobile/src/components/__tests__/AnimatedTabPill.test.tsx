import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet, Text, type ViewStyle } from 'react-native';

import { AnimatedTabPill } from '@/src/components/AnimatedTabPill';
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
