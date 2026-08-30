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

  // Manage holds the state itself, so that pressing Edit on a list row can
  // reopen a card that is already mounted and shut.
  it('lets a parent hold the open state', async () => {
    const onOpenChange = jest.fn();
    const card = (open: boolean) => (
      <CollapsibleCard onOpenChange={onOpenChange} open={open} summary="Two teams and a kickoff." title="Add matches">
        <Text>Kickoff field</Text>
      </CollapsibleCard>
    );
    const screen = await render(card(false));
    expect(screen.queryByText('Kickoff field')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Show add matches form' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true));
    // Nothing opens until the parent says so.
    expect(screen.queryByText('Kickoff field')).toBeNull();

    screen.rerender(card(true));
    await waitFor(() => expect(screen.getByText('Kickoff field')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Hide add matches form' })).toBeTruthy();
  });
});
