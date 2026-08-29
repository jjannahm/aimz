import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { PlayerPickerField } from '@/src/components/PlayerPickerField';
import type { Player } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const players = [
  { id: 'p-1', name: 'Amina Adel' },
  { id: 'p-2', name: 'Amina Sabry' },
  { id: 'p-3', name: 'Aya Nabil' },
] as Player[];

function Harness({ mode = 'single', initial = [], onChange }: {
  mode?: 'single' | 'multiple';
  initial?: string[];
  onChange?: (ids: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = React.useState(initial);
  return <PlayerPickerField
    label={mode === 'multiple' ? 'Children' : 'Player'}
    onChange={(ids) => { setSelectedIds(ids); onChange?.(ids); }}
    players={players}
    selectedIds={selectedIds}
    selectionMode={mode}
  />;
}

describe('PlayerPickerField', () => {
  it('keeps the roster collapsed until its field is opened', async () => {
    const screen = await render(<Harness />);

    expect(screen.getByText('Choose a player')).toBeTruthy();
    expect(screen.queryByText('Amina Adel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Player' }).props.accessibilityState).toEqual({ expanded: false });

    await fireEvent.press(screen.getByRole('button', { name: 'Player' }));

    await waitFor(() => expect(screen.getByTestId('player-picker-search')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Player' }).props.accessibilityState).toEqual({ expanded: true });
  });

  it('filters player names case-insensitively and explains an empty result', async () => {
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByRole('button', { name: 'Player' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-search')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('player-picker-search'), 'sABr');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Amina Sabry' })).toBeTruthy());
    expect(screen.queryByRole('radio', { name: 'Amina Adel' })).toBeNull();

    await fireEvent.changeText(screen.getByTestId('player-picker-search'), 'zzzz');
    await waitFor(() => expect(screen.getByText('No players match that.')).toBeTruthy());
  });

  it('commits one player and closes single-select mode', async () => {
    const onChange = jest.fn();
    const screen = await render(<Harness onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Player' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Amina Adel' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('radio', { name: 'Amina Adel' }));

    expect(onChange).toHaveBeenCalledWith(['p-1']);
    await waitFor(() => expect(screen.queryByTestId('player-picker-menu')).toBeNull());
    expect(screen.getByText('Amina Adel')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Player' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Amina Adel' }).props.accessibilityState).toEqual({ selected: true }));
  });

  it('keeps multi-select mode open, exposes checked state, and closes through Done', async () => {
    const screen = await render(<Harness mode="multiple" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Children' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Amina Adel' })).toBeTruthy());

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Amina Adel' }));

    expect(screen.getByRole('button', { name: 'Children' }).props.accessibilityState).toEqual({ expanded: true });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Amina Adel' }).props.accessibilityState.checked).toBe(true));
    await waitFor(() => expect(screen.getByTestId('player-picker-chip-p-1')).toBeTruthy());
    expect(screen.getByText('1 child selected')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('player-picker-menu')).toBeNull());
  });

  it('shows selected children in roster order and removes them from their chips', async () => {
    const onChange = jest.fn();
    const screen = await render(<Harness mode="multiple" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Children' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Aya Nabil' })).toBeTruthy());
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Aya Nabil' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-chip-p-3')).toBeTruthy());
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Amina Adel' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-chip-p-1')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('player-picker-menu')).toBeNull());

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel).filter((label) => label?.startsWith('Remove '))).toEqual([
      'Remove Amina Adel',
      'Remove Aya Nabil',
    ]);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Amina Adel' }));
    expect(onChange).toHaveBeenLastCalledWith(['p-3']);
    await waitFor(() => expect(screen.queryByTestId('player-picker-chip-p-1')).toBeNull());
    expect(screen.getByTestId('player-picker-chip-p-3')).toBeTruthy();
  });

  it('resets only the query when dismissed by the backdrop or platform back', async () => {
    const screen = await render(<Harness initial={['p-1']} mode="multiple" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Children' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-search')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('player-picker-search'), 'sabry');
    await fireEvent.press(screen.getByTestId('player-picker-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('player-picker-search')).toBeNull());

    await fireEvent.press(screen.getByRole('button', { name: 'Children' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-search').props.value).toBe(''));
    expect(screen.getByTestId('player-picker-chip-p-1')).toBeTruthy();

    await act(async () => screen.getByTestId('player-picker-modal').props.onRequestClose());
    await waitFor(() => expect(screen.queryByTestId('player-picker-menu')).toBeNull());
    expect(screen.getByTestId('player-picker-chip-p-1')).toBeTruthy();
  });
});
