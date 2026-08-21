import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { themePreferenceStore } from '@/src/lib/themePreference';
import { darkColors, lightColors } from '@/src/theme';
import { ThemeProvider, useAppTheme } from '@/src/theme/ThemeProvider';

let mockSystemScheme: 'light' | 'dark' | null = 'dark';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockKeychain.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  }),
}));

function Probe() {
  const { colors, mode } = useAppTheme();
  return <Text>{`${mode}:${colors.background}`}</Text>;
}

const renderProbe = () => render(<ThemeProvider><Probe /></ThemeProvider>);

describe('theme palettes', () => {
  it('gives every dark token a light counterpart', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
  });

  it('never repeats a value across the two backgrounds', () => {
    expect(lightColors.background).not.toBe(darkColors.background);
    expect(lightColors.textPrimary).not.toBe(darkColors.textPrimary);
  });
});

describe('ThemeProvider', () => {
  beforeEach(async () => {
    mockKeychain.clear();
    mockSystemScheme = 'dark';
    await themePreferenceStore.restore();
  });

  it('follows the device while the preference is "system"', async () => {
    mockSystemScheme = 'light';
    renderProbe();
    await waitFor(() => expect(screen.getByText(`light:${lightColors.background}`)).toBeTruthy());
  });

  it('treats an unknown device scheme as dark', async () => {
    mockSystemScheme = null;
    renderProbe();
    await waitFor(() => expect(screen.getByText(`dark:${darkColors.background}`)).toBeTruthy());
  });

  it('lets an explicit choice override the device', async () => {
    mockSystemScheme = 'dark';
    await themePreferenceStore.save('light');
    renderProbe();
    await waitFor(() => expect(screen.getByText(`light:${lightColors.background}`)).toBeTruthy());
  });

  it('remembers the choice across a restart', async () => {
    await themePreferenceStore.save('light');
    // A fresh launch starts from the default and restores from storage.
    await themePreferenceStore.restore();
    expect(themePreferenceStore.get()).toBe('light');
  });

  it('falls back to the system when the stored value is unreadable', async () => {
    mockKeychain.set('aimz.theme.v1', 'aubergine');
    await themePreferenceStore.restore();
    expect(themePreferenceStore.get()).toBe('system');
  });
});
