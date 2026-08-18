import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ChoiceField, getDropdownLayout } from '@/src/components/ChoiceField';

const options = [
  { label: 'First squad', value: 'first' },
  { label: 'Second squad', value: 'second' },
  { label: 'Third squad', value: 'third' },
];

describe('ChoiceField', () => {
  it('preserves the placeholder and inline error while closed', async () => {
    const screen = await render(
      <ChoiceField error="Pick a squad." label="Squad" onChange={jest.fn()} options={options} placeholder="Choose a squad" />,
    );

    expect(screen.getByText('Choose a squad')).toBeTruthy();
    expect(screen.getByText('Pick a squad.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Squad' }).props.accessibilityState).toEqual({ expanded: false });
  });

  it('opens, exposes the selected option, changes the value, and closes', async () => {
    const onChange = jest.fn();
    const screen = await render(
      <ChoiceField label="Squad" onChange={onChange} options={options} value="first" />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Squad' }));

    await waitFor(() => expect(screen.getByText('Second squad')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'First squad' }).props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(screen.getByRole('button', { name: 'Second squad' }));

    expect(onChange).toHaveBeenCalledWith('second');
    await waitFor(() => expect(screen.queryByTestId('choice-menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Squad' }).props.accessibilityState).toEqual({ expanded: false });
  });

  it('closes when the surrounding area is pressed', async () => {
    const screen = await render(
      <ChoiceField label="Squad" onChange={jest.fn()} options={options} value="first" />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Squad' }));
    await waitFor(() => expect(screen.getByTestId('choice-menu')).toBeTruthy());

    fireEvent.press(screen.getByTestId('choice-backdrop'));

    await waitFor(() => expect(screen.queryByTestId('choice-menu')).toBeNull());
  });

  it('closes through the platform back or dismiss request', async () => {
    const screen = await render(
      <ChoiceField label="Squad" onChange={jest.fn()} options={options} value="first" />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Squad' }));
    await waitFor(() => expect(screen.getByTestId('choice-menu')).toBeTruthy());

    await act(async () => screen.getByTestId('choice-modal').props.onRequestClose());

    await waitFor(() => expect(screen.queryByTestId('choice-menu')).toBeNull());
  });

  it('keeps long lists inside a scrollable, height-capped menu', async () => {
    const longOptions = Array.from({ length: 20 }, (_, index) => ({ label: `Squad ${index + 1}`, value: String(index + 1) }));
    const screen = await render(
      <ChoiceField label="Squad" onChange={jest.fn()} options={longOptions} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Squad' }));

    await waitFor(() => expect(screen.getByTestId('choice-options').props.showsVerticalScrollIndicator).toBe(true));
  });
});

describe('getDropdownLayout', () => {
  it('opens below the field when there is room', () => {
    const layout = getDropdownLayout({ x: 20, y: 100, width: 300, height: 52 }, 3, 375, 800);

    expect(layout.opensAbove).toBe(false);
    expect(layout.top).toBe(156);
    expect(layout.width).toBe(300);
  });

  it('opens above a field near the viewport bottom', () => {
    const layout = getDropdownLayout({ x: 20, y: 700, width: 300, height: 52 }, 3, 375, 800);

    expect(layout.opensAbove).toBe(true);
    expect(layout.top).toBe(550);
  });

  it('caps long menus and keeps them within horizontal gutters', () => {
    const layout = getDropdownLayout({ x: 300, y: 100, width: 200, height: 52 }, 20, 375, 800);

    expect(layout.maxHeight).toBe(280);
    expect(layout.left).toBe(159);
    expect(layout.width).toBe(200);
  });
});
