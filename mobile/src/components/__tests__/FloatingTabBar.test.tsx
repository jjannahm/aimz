import { fireEvent, render } from '@testing-library/react-native';

import { FloatingTabBar } from '@/src/components/FloatingTabBar';

const hidden = { display: 'none' } as const;

type Descriptors = Record<string, { options: { title?: string; tabBarItemStyle?: { display?: 'none' | 'flex' } } }>;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) }));

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));

/**
 * The four an administrator is offered, with the two the layout hides
 * alongside. `href: null` is not what a bar sees: expo-router takes `href` off
 * the options and marks the item `display: 'none'`, so that is what is mocked.
 */
function props(index = 0): { state: { index: number; routes: { key: string; name: string }[] }; descriptors: Descriptors; navigation: { emit: typeof emit; navigate: typeof navigate } } {
  const routes = [
    { key: 'k-index', name: 'index' },
    { key: 'k-standings', name: 'standings' },
    { key: 'k-players', name: 'players' },
    { key: 'k-my-team-hidden', name: 'my-team' },
    { key: 'k-manage', name: 'manage' },
    { key: 'k-settings', name: 'settings' },
  ];
  return {
    state: { index, routes },
    descriptors: {
      'k-index': { options: { title: 'Matches' } },
      'k-standings': { options: { title: 'Standings' } },
      'k-players': { options: { title: 'Players' } },
      'k-manage': { options: { title: 'Manage' } },
      'k-my-team-hidden': { options: { title: 'Hub', tabBarItemStyle: hidden } },
      'k-settings': { options: { title: 'Settings', tabBarItemStyle: hidden } },
    },
    navigation: { emit, navigate },
  };
}

describe('FloatingTabBar', () => {
  afterEach(() => jest.clearAllMocks());

  it('leaves out the routes the layout hid', async () => {
    const screen = await render(<FloatingTabBar {...props()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    // The calendar belongs inside Manage and the Hub, not the bar itself.
    expect(screen.queryByLabelText('Hub')).toBeNull();
    expect(screen.queryByLabelText('Settings')).toBeNull();
    expect(screen.getByLabelText('Manage')).toBeTruthy();
  });

  // The label belongs to the selected tab alone; the rest are their glyph.
  // The bar a player is offered: Manage is theirs to lack, Hub is theirs to
  // have, and Settings is nobody's — it lives in the header now.
  it('offers a player Matches, Standings, Players and Hub, and nothing else', async () => {
    const forPlayer = props(0);
    forPlayer.state.routes = [
      { key: 'k-index', name: 'index' },
      { key: 'k-standings', name: 'standings' },
      { key: 'k-players', name: 'players' },
      { key: 'k-my-team', name: 'my-team' },
      { key: 'k-manage-hidden', name: 'manage' },
      { key: 'k-settings', name: 'settings' },
    ];
    forPlayer.descriptors = {
      'k-index': { options: { title: 'Matches' } },
      'k-standings': { options: { title: 'Standings' } },
      'k-players': { options: { title: 'Players' } },
      'k-my-team': { options: { title: 'Hub' } },
      'k-manage-hidden': { options: { title: 'Manage', tabBarItemStyle: hidden } },
      'k-settings': { options: { title: 'Settings', tabBarItemStyle: hidden } },
    };
    const screen = await render(<FloatingTabBar {...forPlayer} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(['Matches', 'Standings', 'Players', 'Hub']);
  });

  it('offers an administrator Matches, Standings, Players and Manage, and nothing else', async () => {
    const screen = await render(<FloatingTabBar {...props(0)} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual(['Matches', 'Standings', 'Players', 'Manage']);
  });

  it('names only the tab that is selected', async () => {
    const screen = await render(<FloatingTabBar {...props(0)} />);
    expect(screen.getByText('Matches')).toBeTruthy();
    expect(screen.queryByText('Standings')).toBeNull();
    expect(screen.queryByText('Hub')).toBeNull();
  });

  it('moves the name to whichever tab is selected', async () => {
    const screen = await render(<FloatingTabBar {...props(4)} />);
    expect(screen.getByText('Manage')).toBeTruthy();
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
