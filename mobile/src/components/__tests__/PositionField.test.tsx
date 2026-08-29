import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { PositionField } from '@/src/components/PositionField';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

/** A field that keeps whatever it is given, the way the real form does. */
function Harness({ onPick }: { onPick?: (code: string) => void }) {
  const [value, setValue] = React.useState('');
  return <PositionField onChange={(code) => { setValue(code); onPick?.(code); }} value={value} />;
}

type Screen = Awaited<ReturnType<typeof render>>;

/** Opens the list and returns the screen, since every test starts here. */
async function open(screen: Screen) {
  await fireEvent.press(screen.getByTestId('position-trigger'));
  await waitFor(() => expect(screen.getByTestId('position-search')).toBeTruthy());
  return screen;
}

describe('PositionField', () => {
  it('offers every position before anything is typed', async () => {
    const screen = await open(await render(<Harness />));
    expect(screen.getByTestId('position-option-GK')).toBeTruthy();
    expect(screen.getByTestId('position-option-ST')).toBeTruthy();
  });

  // The whole reason this is a typeahead and not a picker.
  it('narrows to the positions starting with what is typed', async () => {
    const screen = await open(await render(<Harness />));
    await fireEvent.changeText(screen.getByTestId('position-search'), 'l');
    await waitFor(() => expect(screen.queryByTestId('position-option-GK')).toBeNull());
    for (const code of ['LB', 'LWB', 'LM', 'LW']) expect(screen.getByTestId(`position-option-${code}`)).toBeTruthy();
    expect(screen.queryByTestId('position-option-ST')).toBeNull();
  });

  it('finds a position by a word of its name', async () => {
    const screen = await open(await render(<Harness />));
    await fireEvent.changeText(screen.getByTestId('position-search'), 'wing');
    await waitFor(() => expect(screen.getByTestId('position-option-LW')).toBeTruthy());
    expect(screen.getByTestId('position-option-RWB')).toBeTruthy();
    expect(screen.queryByTestId('position-option-CM')).toBeNull();
  });

  it('says so when nothing matches, rather than showing an empty list', async () => {
    const screen = await open(await render(<Harness />));
    await fireEvent.changeText(screen.getByTestId('position-search'), 'zzz');
    await waitFor(() => expect(screen.getByText('No position matches that.')).toBeTruthy());
  });

  it('commits the code that was picked, and shows its name', async () => {
    const onPick = jest.fn();
    const screen = await open(await render(<Harness onPick={onPick} />));
    await fireEvent.changeText(screen.getByTestId('position-search'), 'lw');
    await waitFor(() => expect(screen.getByTestId('position-option-LWB')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('position-option-LWB'));
    expect(onPick).toHaveBeenCalledWith('LWB');
    await waitFor(() => expect(screen.getByText('LWB · Left wing-back')).toBeTruthy());
  });

  // What was typed is a query, not a value: only a real position can be stored.
  it('drops abandoned typing instead of keeping it as a position', async () => {
    const onPick = jest.fn();
    const screen = await open(await render(<Harness onPick={onPick} />));
    await fireEvent.changeText(screen.getByTestId('position-search'), 'stri');
    await fireEvent.press(screen.getByTestId('position-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('position-search')).toBeNull());
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a position')).toBeTruthy();
  });

  it('starts a fresh search the next time it is opened', async () => {
    const screen = await open(await render(<Harness />));
    await fireEvent.changeText(screen.getByTestId('position-search'), 'gk');
    await fireEvent.press(screen.getByTestId('position-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('position-search')).toBeNull());
    await open(screen);
    expect(screen.getByTestId('position-search').props.value).toBe('');
    expect(screen.getByTestId('position-option-ST')).toBeTruthy();
  });
});
