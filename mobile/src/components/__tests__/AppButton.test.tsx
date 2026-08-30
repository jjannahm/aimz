import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppButton } from '@/src/components/AppButton';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

describe('AppButton', () => {
  it('runs its action and exposes button semantics', async () => {
    const onPress = jest.fn();
    const screen = await render(<AppButton label="Save match" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Save match' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not run while disabled', async () => {
    const onPress = jest.fn();
    const screen = await render(<AppButton disabled label="Save match" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Save match' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps its accessible name when it shows only an icon', async () => {
    const onPress = jest.fn();
    const screen = await render(<AppButton icon="trash" iconOnly label="Delete" onPress={onPress} variant="danger" />);
    fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    // The word itself is gone from the row; only the glyph remains.
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('accepts a custom icon without changing the button semantics', async () => {
    const onPress = jest.fn();
    const screen = await render(<AppButton icon={<Text testID="custom-icon">Family</Text>} iconOnly label="Private roster details" onPress={onPress} />);
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Private roster details' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Private roster details')).toBeNull();
  });
});
