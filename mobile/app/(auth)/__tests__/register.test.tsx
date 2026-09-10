import { fireEvent, render } from '@testing-library/react-native';

import RegisterScreen from '@/app/(auth)/register';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => React.createElement(Text, null, children),
    router: { push: jest.fn(), replace: jest.fn() },
    useLocalSearchParams: () => ({ code: 'AIMZ-2026-AA' }),
    usePathname: () => '/register',
  };
});
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ register: jest.fn() }) }));
jest.mock('@/src/lib/api', () => ({
  api: { resolveInvite: jest.fn() },
  ApiError: class extends Error {},
}));

const openAccountStep = async () => {
  jest.mocked(api.resolveInvite).mockResolvedValue({ kind: 'parent', label: 'Sami family', team_id: null, team_name: null, players: [], requires_application: false } as never);
  const screen = await render(<RegisterScreen />);
  // The code arrives in the route, so the screen resolves it and moves on by
  // itself; the account step is where the password lives.
  await screen.findByLabelText('Password');
  return screen;
};

describe('creating an account', () => {
  afterEach(() => jest.clearAllMocks());

  /**
   * A password of eight characters is not missing, it is short — and "Enter
   * None if it does not apply" is advice that makes no sense for a password
   * and would be dangerous if anybody took it.
   */
  it('says how long a password has to be, not that it is missing', async () => {
    const screen = await openAccountStep();
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Sami Farid');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sami@aimz.test');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'short123');

    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 10 characters.')).toBeTruthy();
    expect(screen.queryByText(/Enter None/u)).toBeNull();
  });

  // "Enter None" belongs to the application questions, where a player with no
  // previous academy still has to answer. A name is not one of those.
  it('does not tell somebody to call themselves None', async () => {
    const screen = await openAccountStep();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sami@aimz.test');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long-enough-password');

    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This field is required.')).toBeTruthy();
    expect(screen.queryByText(/Enter None/u)).toBeNull();
  });

  it('lets a long enough password through', async () => {
    const screen = await openAccountStep();
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Sami Farid');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sami@aimz.test');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long-enough-password');

    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.queryByText('Use at least 10 characters.')).toBeNull();
  });
});
