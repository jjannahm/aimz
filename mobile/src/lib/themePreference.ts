import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ThemePreference } from '@/src/theme';

const preferenceKey = 'aimz.theme.v1';
const fallback: ThemePreference = 'system';

let currentPreference: ThemePreference = fallback;
const listeners = new Set<(preference: ThemePreference) => void>();

function emit() {
  listeners.forEach((listener) => listener(currentPreference));
}

function getWebStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function readPreference(): Promise<string | null> {
  if (Platform.OS === 'web') return getWebStorage()?.getItem(preferenceKey) ?? null;
  return SecureStore.getItemAsync(preferenceKey);
}

async function writePreference(value: ThemePreference): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(preferenceKey, value);
    return;
  }

  await SecureStore.setItemAsync(preferenceKey, value);
}

function parse(raw: string | null): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : fallback;
}

/**
 * The saved Light / Dark / System choice.
 *
 * Shaped like `sessionStore` so both persist the same way: SecureStore on a
 * device, `localStorage` on web. Anything unreadable or unrecognised falls back
 * to following the system, which is also the value before `restore` resolves.
 */
export const themePreferenceStore = {
  get: () => currentPreference,
  subscribe(listener: (preference: ThemePreference) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async restore() {
    try {
      currentPreference = parse(await readPreference());
    } catch {
      currentPreference = fallback;
    }
    emit();
    return currentPreference;
  },
  async save(preference: ThemePreference) {
    currentPreference = preference;
    emit();
    try {
      await writePreference(preference);
    } catch {
      // A device that refuses the keychain still gets the choice for this run.
    }
  },
};
