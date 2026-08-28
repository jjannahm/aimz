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

  // The pill hugs its own label rather than taking an equal share of the row,
  // which a flexed tab would undo by stretching every one to the same width.
  it('sizes each tab to its own label, not to a share of the row', async () => {
    const screen = await render(<SegmentedTabs onChange={jest.fn()} options={options} value="live" />);
    for (const tab of screen.getAllByRole('tab')) {
      const style = flatten(tab);
      expect(style.flex).toBeUndefined();
      expect(style.flexGrow).toBeUndefined();
      // Room either side of the text, so the tighter pill costs no accuracy.
      expect(style.paddingHorizontal).toBeGreaterThanOrEqual(12);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('leaves an unselected choice as plain text', async () => {
    const screen = await render(<SegmentedTabs onChange={jest.fn()} options={options} value="live" />);
    const resting = flatten(screen.getAllByRole('tab')[1]);
    expect(resting.backgroundColor).toBeUndefined();
    expect(resting.borderWidth).toBeUndefined();
  });
});
