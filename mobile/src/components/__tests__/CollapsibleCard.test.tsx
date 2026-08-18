import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { CollapsibleCard } from '@/src/components/CollapsibleCard';

describe('CollapsibleCard', () => {
  it('starts collapsed and clears sensitive content when closed', async () => {
    const onCollapse = jest.fn();
    const screen = await render(
      <CollapsibleCard onCollapse={onCollapse} summary="Update your sign-in password." title="Change password">
        <Text>Current password field</Text>
      </CollapsibleCard>,
    );

    expect(screen.queryByText('Current password field')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Show change password form' }));
    await waitFor(() => expect(screen.getByText('Current password field')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: 'Hide change password form' }));
    await waitFor(() => expect(screen.queryByText('Current password field')).toBeNull());
    await waitFor(() => expect(onCollapse).toHaveBeenCalledTimes(1));
  });
});
