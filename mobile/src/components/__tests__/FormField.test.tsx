import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { FormField } from '@/src/components/FormField';
import { darkColors } from '@/src/theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const flatten = (node: { props: { style?: unknown } } | null | undefined) => StyleSheet.flatten(node?.props.style) as ViewStyle;

describe('FormField', () => {
  // A flexed group takes a flex basis of zero, so a column hands it an equal
  // share of the free space rather than the height its contents need. That
  // starves a tall field, and the overflow paints over whatever follows it.
  it('leaves its group unflexed, so a tall field is never starved in a column', async () => {
    const screen = await render(<FormField label="Message" multiline value="" />);
    expect(flatten(screen.getByText('Message').parent).flex).toBeUndefined();
  });

  it('lets a row lay the field out through containerStyle', async () => {
    const screen = await render(<FormField containerStyle={{ flex: 1 }} label="Home score" value="" />);
    expect(flatten(screen.getByText('Home score').parent).flex).toBe(1);
  });

  it('stretches the shell around a multiline input rather than centring it', async () => {
    const screen = await render(<FormField label="Notes" multiline value="" />);
    expect(flatten(screen.getByLabelText('Notes').parent).alignItems).toBe('stretch');
  });

  it('keeps a single-line input centred in its shell', async () => {
    const screen = await render(<FormField label="Venue" value="" />);
    expect(flatten(screen.getByLabelText('Venue').parent).alignItems).toBe('center');
  });

  it('moves focus styling to the contained shell and preserves callbacks', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const screen = await render(<FormField label="Number" onBlur={onBlur} onFocus={onFocus} value="" />);
    const input = screen.getByLabelText('Number');

    expect(StyleSheet.flatten(input.props.style)).toMatchObject({ minWidth: 0, outlineWidth: 0 });
    fireEvent(input, 'focus', { nativeEvent: {} });
    expect(onFocus).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId('form-field-shell').props.style)).toMatchObject({ borderColor: darkColors.accent, borderWidth: 2, overflow: 'hidden' }));

    fireEvent(input, 'blur', { nativeEvent: {} });
    expect(onBlur).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId('form-field-shell').props.style)).toMatchObject({ borderColor: darkColors.border, borderWidth: 1 }));
  });

  it('keeps the error ring visible while focused', async () => {
    const screen = await render(<FormField error="Enter a number" label="Number" value="" />);
    fireEvent(screen.getByLabelText('Number'), 'focus', { nativeEvent: {} });
    await waitFor(() => expect(StyleSheet.flatten(screen.getByTestId('form-field-shell').props.style)).toMatchObject({ borderColor: darkColors.error, borderWidth: 2 }));
  });
});
