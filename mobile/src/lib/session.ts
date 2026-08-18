import * as SecureStore from 'expo-secure-store';

import type { TokenResponse } from '@/src/types/api';

const sessionKey = 'aimz.session.v1';
let currentSession: TokenResponse | null = null;
const listeners = new Set<(session: TokenResponse | null) => void>();

function emit() {
  listeners.forEach((listener) => listener(currentSession));
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
    const raw = await SecureStore.getItemAsync(sessionKey);
    currentSession = raw ? (JSON.parse(raw) as TokenResponse) : null;
    emit();
    return currentSession;
  },
  async save(session: TokenResponse) {
    currentSession = session;
    await SecureStore.setItemAsync(sessionKey, JSON.stringify(session), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    emit();
  },
  async clear() {
    currentSession = null;
    await SecureStore.deleteItemAsync(sessionKey);
    emit();
  },
};
