import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { PrivacyScreen } from '@/src/components/PrivacyScreen';

jest.mock('@/src/theme/ThemeProvider', () => ({ useAppTheme: () => ({ colors: { background: '#000' } }) }));

/**
 * The platform photographs the screen when the app leaves the foreground, and
 * writes that photograph to disk. On a player's personal details that is a copy
 * of a child's record outside the Keychain, so the cover has to be up before
 * the snapshot is taken rather than after.
 */
describe('the cover the app switcher photographs', () => {
  const listeners: ((state: string) => void)[] = [];
  beforeEach(() => {
    listeners.length = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (state: string) => void) => {
      listeners.push(handler);
      return { remove: () => undefined };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  const move = async (state: string) => { await act(async () => { listeners.forEach((listener) => { listener(state); }); }); };

  // Queried through the rendered tree rather than by test id: the cover sets
  // `accessibilityElementsHidden`, which is right -- a screen reader has
  // nothing to say about it and must not read the screen behind it -- and which
  // also takes the node out of the accessibility queries.
  const covered = (view: Awaited<ReturnType<typeof render>>) =>
    JSON.stringify(view.toJSON() ?? null).includes('privacy-screen');

  it('is absent while the app is in front', async () => {
    const view = await render(<PrivacyScreen />);
    expect(covered(view)).toBe(false);
  });

  it('covers the screen the moment the app stops being active, and lifts on return', async () => {
    const view = await render(<PrivacyScreen />);
    // `inactive` is the state iOS passes through while it takes the snapshot.
    // Waiting for `background` would raise the cover after the photograph.
    await move('inactive');
    expect(covered(view)).toBe(true);
    await move('background');
    expect(covered(view)).toBe(true);
    await move('active');
    expect(covered(view)).toBe(false);
  });
});
