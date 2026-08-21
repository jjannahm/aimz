import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
});
