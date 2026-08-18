import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { TokenResponse } from '@/src/types/api';

const sessionKey = 'aimz.session.v1';
let currentSession: TokenResponse | null = null;
const listeners = new Set<(session: TokenResponse | null) => void>();

function emit() {
  listeners.forEach((listener) => listener(currentSession));
}

function getWebStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function readSession(): Promise<string | null> {
  if (Platform.OS === 'web') return getWebStorage()?.getItem(sessionKey) ?? null;
  return SecureStore.getItemAsync(sessionKey);
}

async function writeSession(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(sessionKey, value);
    return;
  }

  await SecureStore.setItemAsync(sessionKey, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function removeSession(): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(sessionKey);
    return;
  }

  await SecureStore.deleteItemAsync(sessionKey);
}

export const sessionStore = {
  get: () => currentSession,
  subscribe(listener: (session: TokenResponse | null) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async restore() {
    try {
      const raw = await readSession();
      currentSession = raw ? (JSON.parse(raw) as TokenResponse) : null;
    } catch {
      currentSession = null;
      await removeSession().catch(() => undefined);
    }
    emit();
    return currentSession;
  },
  async save(session: TokenResponse) {
    currentSession = session;
    await writeSession(JSON.stringify(session));
    emit();
  },
  async clear() {
    currentSession = null;
    await removeSession();
    emit();
  },
};
