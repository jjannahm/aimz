import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { SegmentedControl } from '@/src/components/SegmentedControl';

const options = [
  { label: 'Live', value: 'live' },
  { accessibilityLabel: 'Matches coming up', label: 'Upcoming', value: 'scheduled' },
  { label: 'Results', value: 'finished' },
] as const;

const flattenView = (node: { props: { style?: unknown } } | null | undefined) => StyleSheet.flatten(node?.props.style) as ViewStyle;
const flattenText = (node: { props: { style?: unknown } } | null | undefined) => StyleSheet.flatten(node?.props.style) as TextStyle;

describe('SegmentedControl', () => {
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

    fireEvent.press(screen.getByRole('tab', { name: 'Results' }));
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
    const bar = flattenView(screen.getByLabelText('Match filter'));
    const selected = flattenView(screen.getAllByRole('tab')[0]);
    const resting = flattenView(screen.getAllByRole('tab')[1]);

    expect(bar.padding).toBe(0);
    expect(bar.gap).toBe(0);
    expect(bar.overflow).toBe('hidden');
    expect(bar.borderWidth).toBe(1);
    expect(selected.backgroundColor).toBeDefined();
    expect(selected.borderRadius).toBeUndefined();
    expect(resting.backgroundColor).toBeUndefined();
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
