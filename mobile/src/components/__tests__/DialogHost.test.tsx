import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DialogHost } from '@/src/components/DialogHost';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('DialogHost', () => {
  it('runs the action only once the confirmation is accepted', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<DialogHost />);

    confirmAction('End this match now?', 'Final score will be locked in.', 'End match', onConfirm);

    expect(await screen.findByText('End this match now?')).toBeTruthy();
    expect(screen.getByText('Final score will be locked in.')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'End match' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // The dialog closes itself, since the action often navigates away.
    await waitFor(() => expect(screen.queryByText('End this match now?')).toBeNull());
  });

  it('drops the action when cancelled', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<DialogHost />);

    confirmAction('Delete Amina Adel?', 'This cannot be undone.', 'Delete', onConfirm);
    fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Delete Amina Adel?')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a message with nothing to cancel', async () => {
    const screen = await render(<DialogHost />);

    showMessage('Match not ended', 'Try again.');

    expect(await screen.findByText('Match not ended')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByText('Match not ended')).toBeNull());
  });

  it('dismisses from the backdrop without running the action', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<DialogHost />);

    confirmAction('Remove event?', 'The score will be recalculated.', 'Remove', onConfirm);
    fireEvent.press(await screen.findByRole('button', { name: 'Dismiss dialog' }));

    await waitFor(() => expect(screen.queryByText('Remove event?')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
