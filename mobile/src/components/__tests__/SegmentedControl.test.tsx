import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { SegmentedControl } from '@/src/components/SegmentedControl';
import { theme } from '@/src/theme';

const options = [
  { label: 'Live', value: 'live' },
  { accessibilityLabel: 'Matches coming up', label: 'Upcoming', value: 'scheduled' },
  { label: 'Results', value: 'finished' },
] as const;

const twoOptions = [
  { label: 'Teams', value: 'teams' },
  { label: 'Leaderboards', value: 'leaderboards' },
] as const;

const flattenView = (node: { props: { style?: unknown } } | null | undefined) => StyleSheet.flatten(node?.props.style) as ViewStyle;
const flattenText = (node: { props: { style?: unknown } } | null | undefined) => StyleSheet.flatten(node?.props.style) as TextStyle;

async function layoutTabs(tabs: ReturnType<RenderResult['getAllByRole']>, width = 100) {
  for (const [index, tab] of tabs.entries()) {
    await fireEvent(tab, 'layout', { nativeEvent: { layout: { height: 44, width, x: index * width, y: 0 } } });
  }
}

describe('SegmentedControl', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('offers every choice and exposes the selected tab', async () => {
    const screen = await render(<SegmentedControl label="Match filter" onChange={jest.fn()} options={options} value="scheduled" />);
    const tabs = screen.getAllByRole('tab');

    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual([false, true, false]);
    expect(screen.getByLabelText('Match filter')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Matches coming up' })).toBeTruthy();
  });

  it('hands back whichever segment was pressed', async () => {
    const onChange = jest.fn();
    const screen = await render(<SegmentedControl onChange={onChange} options={options} value="live" />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Results' }));
    expect(onChange).toHaveBeenCalledWith('finished');
  });

  it('gives every segment an equal full-height share', async () => {
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={options} value="live" />);

    for (const tab of screen.getAllByRole('tab')) {
      const style = flattenView(tab);
      expect(style.flex).toBe(1);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBe(0);
      expect(style.paddingHorizontal).toBe(0);
    }
  });

  it('leaves the browser no focus ring to draw over a tab', async () => {
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={options} value="live" />);

    // The ring is drawn with `outline-style: auto`, which ignores a width on
    // its own, so the style has to be overruled alongside it.
    for (const tab of screen.getAllByRole('tab')) {
      const style = flattenView(tab);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe(0);
    }
  });

  it('clips an edge-to-edge active segment inside the one outer border', async () => {
    const screen = await render(<SegmentedControl label="Match filter" onChange={jest.fn()} options={options} value="live" />);
    await layoutTabs(screen.getAllByRole('tab'));
    const bar = flattenView(screen.getByLabelText('Match filter'));
    const indicator = flattenView(screen.getByTestId('segmented-control-indicator'));

    expect(bar.padding).toBe(0);
    expect(bar.gap).toBe(0);
    expect(bar.overflow).toBe('hidden');
    expect(bar.borderWidth).toBe(1);
    expect(indicator.backgroundColor).toBeDefined();
    expect(indicator.bottom).toBe(0);
    expect(indicator.top).toBe(0);
    expect(indicator.width).toBe(100);
  });

  it.each(options.map((option) => option.value))('keeps both indicator ends rounded when %s is selected', async (value) => {
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={options} value={value} />);
    await layoutTabs(screen.getAllByRole('tab'));

    const indicator = flattenView(screen.getByTestId('segmented-control-indicator'));
    expect(indicator.borderRadius).toBe(theme.radius.pill);
  });

  it('slides one indicator to the newly selected tab', async () => {
    const spring = jest.spyOn(Animated, 'spring');
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={options} value="live" />);
    await layoutTabs(screen.getAllByRole('tab'));

    await screen.rerender(<SegmentedControl onChange={jest.fn()} options={options} value="finished" />);

    expect(screen.getAllByTestId('segmented-control-indicator')).toHaveLength(1);
    expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bounciness: 0,
      speed: 16,
      toValue: 200,
      useNativeDriver: true,
    }));
  });

  it('fills and positions a half-width indicator for a two-tab control', async () => {
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={twoOptions} value="leaderboards" />);
    await layoutTabs(screen.getAllByRole('tab'), 150);

    const indicator = flattenView(screen.getByTestId('segmented-control-indicator'));
    const transform = indicator.transform?.[0] as { translateX?: number };
    expect(indicator.width).toBe(150);
    expect(transform.translateX).toBe(150);
  });

  it('snaps the indicator when reduced motion is enabled', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
    const spring = jest.spyOn(Animated, 'spring');
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={options} value="live" />);
    await layoutTabs(screen.getAllByRole('tab'));

    await screen.rerender(<SegmentedControl onChange={jest.fn()} options={options} value="scheduled" />);

    expect(spring).not.toHaveBeenCalled();
    const indicator = flattenView(screen.getByTestId('segmented-control-indicator'));
    const transform = indicator.transform?.[0] as { translateX?: number };
    expect(transform.translateX).toBe(100);
  });

  it('keeps every label at the same size while emphasizing the selected one', async () => {
    const screen = await render(<SegmentedControl onChange={jest.fn()} options={options} value="live" />);
    const labels = options.map((option) => flattenText(screen.getByText(option.label)));

    expect(new Set(labels.map((style) => style.fontSize)).size).toBe(1);
    expect(new Set(labels.map((style) => style.letterSpacing)).size).toBe(1);
    expect(labels[0]?.fontWeight).toBe('900');
    expect(labels[1]?.fontWeight).toBe('800');
  });
});
