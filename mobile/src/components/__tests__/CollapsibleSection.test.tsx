import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { CollapsibleSection } from '@/src/components/CollapsibleSection';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('CollapsibleSection', () => {
  it('starts collapsed and toggles its content', async () => {
    const screen = await render(
      <CollapsibleSection count={15} title="Substitutes">
        <Text>Malak Sherif</Text>
      </CollapsibleSection>,
    );

    // The count is readable while collapsed, so the header still says how much it hides.
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.queryByText('Malak Sherif')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Show substitutes' }));
    await waitFor(() => expect(screen.getByText('Malak Sherif')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Hide substitutes' }));
    await waitFor(() => expect(screen.queryByText('Malak Sherif')).toBeNull());
  });

  it('can start open when the content is the point of the screen', async () => {
    const screen = await render(
      <CollapsibleSection defaultOpen title="Starting">
        <Text>Nour Hassan</Text>
      </CollapsibleSection>,
    );
    expect(screen.getByText('Nour Hassan')).toBeTruthy();
  });

  it('opens a search box from the header, and clears it on the way out', async () => {
    const onChange = jest.fn();
    function Host() {
      const [value, setValue] = useState('');
      return (
        <CollapsibleSection count={2} search={{ onChange: (next) => { onChange(next); setValue(next); }, resultCount: 1, value }} title="Current players">
          <Text>Amina Adel</Text>
        </CollapsibleSection>
      );
    }
    const screen = await render(<Host />);

    // The magnifier unfolds the section as well: a search that hid its own
    // results would be no use.
    expect(screen.queryByText('Amina Adel')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Search current players' }));
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('search-input'), 'amina');
    expect(onChange).toHaveBeenLastCalledWith('amina');
    expect(screen.getByText('1 match')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Hide the search for current players' }));
    await waitFor(() => expect(screen.queryByTestId('search-input')).toBeNull());
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByText('Amina Adel')).toBeTruthy();
  });
});
