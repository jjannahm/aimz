import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { themePreferenceStore } from '@/src/lib/themePreference';
import { darkColors, lightColors, theme } from '@/src/theme';
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

  it('uses the compact editorial core tokens in both modes', () => {
    expect(darkColors).toMatchObject({ background: '#08080C', surface: '#121216', surfaceRaised: '#1A1A20', border: '#2C2B32', accent: '#3B82F6', accentSoft: '#0EA2E7', leaderAccent: '#3B82F6', textPrimary: '#F5F2EA' });
    expect(lightColors).toMatchObject({ background: '#F2F0E8', surface: '#FBFAF5', surfaceRaised: '#E6E2D8', border: '#CBC7BD', accent: '#3B82F6', accentSoft: '#1E40AF', leaderAccent: '#1E40AF' });
    expect(Object.values(theme.spacing)).toEqual([4, 8, 12, 16, 24, 32, 48]);
  });

  it('provides interface and numeric typography recipes', () => {
    expect(theme.typography.body).toMatchObject({ fontFamily: theme.font.regular, fontSize: 16 });
    expect(theme.typography.heading.fontFamily).toBe(theme.font.bold);
    expect(theme.typography.numeric.fontFamily).toBe(theme.font.mono);
    expect(theme.typography.numericBold.fontFamily).toBe(theme.font.monoBold);
  });

  it('keeps essential text and control pairs at WCAG AA contrast', () => {
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/.{2}/g)!.map((value) => parseInt(value, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const contrast = (a: string, b: string) => {
      const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (bright! + 0.05) / (dark! + 0.05);
    };
    for (const colors of [darkColors, lightColors]) {
      expect(contrast(colors.textPrimary, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.textSecondary, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.accentSoft, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.leaderAccent, colors.leaderSurface)).toBeGreaterThanOrEqual(4.5);
    }
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
