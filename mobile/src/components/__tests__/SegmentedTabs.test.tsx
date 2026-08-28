import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { SegmentedTabs } from '@/src/components/SegmentedTabs';

const options = [
  { label: 'Live', value: 'live' },
  { label: 'Upcoming', value: 'scheduled' },
  { label: 'Results', value: 'finished' },
] as const;

const flatten = (node: { props: { style?: unknown } } | null | undefined) => StyleSheet.flatten(node?.props.style) as ViewStyle;

describe('SegmentedTabs', () => {
  it('offers every choice, and marks the one in hand', async () => {
    const screen = await render(<SegmentedTabs onChange={jest.fn()} options={options} value="scheduled" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual([false, true, false]);
    expect(screen.getByText('Upcoming')).toBeTruthy();
  });

  it('hands back whichever was pressed', async () => {
    const onChange = jest.fn();
    const screen = await render(<SegmentedTabs onChange={onChange} options={options} value="live" />);
    fireEvent.press(screen.getByText('Results'));
    expect(onChange).toHaveBeenCalledWith('finished');
  });

  // The bar spans the page and the choices are spread across it, so each tab
  // takes an equal share — the whole of which stays tappable.
  it('spreads the choices across the bar, and keeps each one tappable', async () => {
    const screen = await render(<SegmentedTabs onChange={jest.fn()} options={options} value="live" />);
    for (const tab of screen.getAllByRole('tab')) {
      const style = flatten(tab);
      expect(style.flex).toBe(1);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  // Only the pill is tight: it is drawn around the word and the room either
  // side of it, rather than filling the share of the bar the tab occupies.
  it('keeps the pill to the width of the word', async () => {
    const screen = await render(<SegmentedTabs onChange={jest.fn()} options={options} value="live" />);
    const hug = flatten(screen.getByText('Live').parent);
    expect(hug.paddingHorizontal).toBeGreaterThanOrEqual(12);
    expect(hug.flex).toBeUndefined();
    expect(hug.alignSelf).not.toBe('stretch');
  });

  it('leaves an unselected choice as plain text', async () => {
    const screen = await render(<SegmentedTabs onChange={jest.fn()} options={options} value="live" />);
    const resting = flatten(screen.getAllByRole('tab')[1]);
    expect(resting.backgroundColor).toBeUndefined();
    expect(resting.borderWidth).toBeUndefined();
  });
});
