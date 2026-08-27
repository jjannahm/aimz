import { fireEvent, render } from '@testing-library/react-native';

import { FloatingTabBar } from '@/src/components/FloatingTabBar';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) }));

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));

/** The four a player is offered, with the two the layout hides alongside. */
function props(index = 0) {
  const routes = [
    { key: 'k-index', name: 'index' },
    { key: 'k-standings', name: 'standings' },
    { key: 'k-players', name: 'players' },
    { key: 'k-my-team', name: 'my-team' },
    { key: 'k-manage', name: 'manage' },
    { key: 'k-settings', name: 'settings' },
  ];
  return {
    state: { index, routes },
    descriptors: {
      'k-index': { options: { title: 'Matches' } },
      'k-standings': { options: { title: 'Standings' } },
      'k-players': { options: { title: 'Players' } },
      'k-my-team': { options: { title: 'Hub' } },
      'k-manage': { options: { title: 'Manage', href: null } },
      'k-settings': { options: { title: 'Settings', href: null } },
    },
    navigation: { emit, navigate },
  };
}

describe('FloatingTabBar', () => {
  afterEach(() => jest.clearAllMocks());

  it('leaves out the routes the layout hid', async () => {
    const screen = await render(<FloatingTabBar {...props()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByLabelText('Manage')).toBeNull();
    expect(screen.queryByLabelText('Settings')).toBeNull();
  });

  // The label belongs to the selected tab alone; the rest are their glyph.
  it('names only the tab that is selected', async () => {
    const screen = await render(<FloatingTabBar {...props(0)} />);
    expect(screen.getByText('Matches')).toBeTruthy();
    expect(screen.queryByText('Standings')).toBeNull();
    expect(screen.queryByText('Hub')).toBeNull();
  });

  it('moves the name to whichever tab is selected', async () => {
    const screen = await render(<FloatingTabBar {...props(3)} />);
    expect(screen.getByText('Hub')).toBeTruthy();
    expect(screen.queryByText('Matches')).toBeNull();
  });

  it('opens the tab that was pressed', async () => {
    const screen = await render(<FloatingTabBar {...props(0)} />);
    fireEvent.press(screen.getByLabelText('Players'));
    expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'k-players', canPreventDefault: true });
    expect(navigate).toHaveBeenCalledWith('players');
  });

  it('stays put when the tab already open is pressed', async () => {
    const screen = await render(<FloatingTabBar {...props(0)} />);
    fireEvent.press(screen.getByLabelText('Matches'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when the press was handled elsewhere', async () => {
    emit.mockReturnValueOnce({ defaultPrevented: true });
    const screen = await render(<FloatingTabBar {...props(0)} />);
    fireEvent.press(screen.getByLabelText('Standings'));
    expect(navigate).not.toHaveBeenCalled();
  });
});
