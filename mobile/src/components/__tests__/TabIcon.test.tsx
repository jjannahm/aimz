import { render } from '@testing-library/react-native';

import { TabIcon as NativeTabIcon } from '@/src/components/TabIcon';
import { TabIcon as WebTabIcon } from '@/src/components/TabIcon.web';
import { TAB_ICON_NAMES } from '@/src/components/tabIcons';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

/**
 * Metro swaps the web file in at bundle time, so jest never loads it on its own
 * and nothing here would have noticed it going stale. It did: the dock asked
 * for a glyph the web set had no entry for, handed React `undefined`, and every
 * player and parent on the web build got a crash instead of a tab bar.
 */
describe.each([['native', NativeTabIcon], ['web', WebTabIcon]])('the %s tab glyphs', (_platform, TabIcon) => {
  it.each(TAB_ICON_NAMES)('draws something for %s', async (name) => {
    const screen = await render(<TabIcon color="#fff" name={name} size={24} />);
    expect(screen.toJSON()).toBeTruthy();
  });
});
