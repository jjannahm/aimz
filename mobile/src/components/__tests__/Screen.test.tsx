import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { CloseButton } from '@/src/components/CloseButton';
import { Screen } from '@/src/components/Screen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, usePathname: () => '/standings' }));

describe('Screen header', () => {
  afterEach(() => jest.clearAllMocks());

  // Settings left the tab bar, so the header is the only way to reach it.
  it('carries a way into settings on every screen', async () => {
    const screen = await render(<Screen title="Matches"><Text>body</Text></Screen>);
    fireEvent.press(screen.getByLabelText('Settings'));
    // The screen it was pressed on travels with it, so closing comes back here.
    expect(router.push).toHaveBeenCalledWith({ pathname: '/settings', params: { from: '/standings' } });
  });

  it('leaves it off the settings screen itself', async () => {
    const screen = await render(<Screen hideSettings title="Settings"><Text>body</Text></Screen>);
    expect(screen.queryByLabelText('Settings')).toBeNull();
  });

  it('keeps a screen of its own action alongside it', async () => {
    const screen = await render(<Screen action={<CloseButton />} title="Game centre"><Text>body</Text></Screen>);
    expect(screen.getByLabelText('Settings')).toBeTruthy();
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  // The header row already holds the brand and two round buttons, so a second
  // line is where a name's shirt and position fit on a phone.
  it('carries a second line under the title when there is one, and nothing when there is not', async () => {
    const with_line = await render(<Screen subtitle="#14 · Centre midfield" title="Amina Adel"><Text>body</Text></Screen>);
    expect(with_line.getByText('Amina Adel')).toBeTruthy();
    expect(with_line.getByText('#14 · Centre midfield')).toBeTruthy();
    // The title is what a reader is taken to; the line under it is not a header.
    expect(with_line.getByRole('header').props.children).toBe('Amina Adel');

    const without = await render(<Screen title="Matches"><Text>body</Text></Screen>);
    expect(without.queryByText('#14 · Centre midfield')).toBeNull();
  });
});
