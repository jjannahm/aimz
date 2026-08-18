import { fireEvent, render } from '@testing-library/react-native';

import { AppButton } from '@/src/components/AppButton';

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
});
