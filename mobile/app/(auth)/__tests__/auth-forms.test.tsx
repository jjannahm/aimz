import { fireEvent, render, waitFor } from '@testing-library/react-native';

import LoginScreen from '@/app/(auth)/login';
import ResetPasswordScreen from '@/app/(auth)/reset-password';
import { useAuth } from '@/src/auth/AuthProvider';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => React.createElement(Text, null, children),
    Redirect: 'Redirect',
  };
});
jest.mock('expo-router/head', () => () => null);
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/src/config', () => ({ appConfig: { enablePasswordReset: true, isStaging: false, webOrigin: 'https://aimz.example' } }));
jest.mock('@/src/lib/api', () => ({
  api: { requestReset: jest.fn(), confirmReset: jest.fn() },
  ApiError: class extends Error {},
}));

describe('authentication forms', () => {
  const signIn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useAuth).mockReturnValue({ signIn } as never);
  });

  it('labels and submits the sign-in form with a clear action', async () => {
    const screen = await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'player@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secure-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('player@example.com', 'secure-password'));
  });

  it('explains an invalid email before requesting a reset code', async () => {
    const screen = await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Email reset code' }));

    expect(await screen.findByText('Enter a valid email.')).toBeTruthy();
    expect(api.requestReset).not.toHaveBeenCalled();
  });

  it('requests a reset code and reveals labelled follow-up fields', async () => {
    jest.mocked(api.requestReset).mockResolvedValue(undefined as never);
    const screen = await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'player@example.com');
    await fireEvent.press(screen.getByRole('button', { name: 'Email reset code' }));

    expect(await screen.findByLabelText('Reset code')).toBeTruthy();
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });
});
