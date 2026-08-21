import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { themePreferenceStore } from '@/src/lib/themePreference';
import { darkColors, themeColors, type ThemeColors, type ThemeMode, type ThemePreference } from '@/src/theme';

type ThemeContextValue = {
  colors: ThemeColors;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

// Rendering without the provider — which every component test does — resolves to
// the dark theme rather than throwing, so a unit test never has to wrap.
const ThemeContext = createContext<ThemeContextValue>({
  colors: darkColors,
  mode: 'dark',
  preference: 'system',
  setPreference: () => undefined,
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setStoredPreference] = useState<ThemePreference>(() => themePreferenceStore.get());

  useEffect(() => {
    const unsubscribe = themePreferenceStore.subscribe(setStoredPreference);
    void themePreferenceStore.restore();
    return unsubscribe;
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    void themePreferenceStore.save(next);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const mode: ThemeMode = preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;
    return { colors: themeColors[mode], mode, preference, setPreference };
  }, [preference, setPreference, systemScheme]);

  useEffect(() => {
    // `+html.tsx` paints the document from the system preference alone, so a
    // saved Light / Dark choice that disagrees with it would show through
    // around the app until this catches up.
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.body.style.backgroundColor = value.colors.background;
  }, [value.colors.background]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active palette. Most components need only this. */
export function useColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

/** The active palette plus the mode and the Light / Dark / System control. */
export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Build a stylesheet from the active palette.
 *
 * `StyleSheet.create` captures colour values when it runs, so a module-scope
 * stylesheet can never follow the mode. Pass a module-scope factory instead: its
 * identity is stable, so the styles are rebuilt only when the palette changes.
 */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const colors = useColors();
  return useMemo(() => factory(colors), [colors, factory]);
}
