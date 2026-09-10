import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const seenKey = 'aimz.announcements.seen.v1';
/** Enough to cover a season of notices without letting the record grow forever. */
const limit = 200;

let seen: string[] = [];
let restored = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function getWebStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') return getWebStorage()?.getItem(seenKey) ?? null;
  return SecureStore.getItemAsync(seenKey);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(seenKey, value);
    return;
  }
  await SecureStore.setItemAsync(seenKey, value);
}

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Which announcements this device has already shown the reader.
 *
 * Nothing on the server records a read, and a notice being read is a matter for
 * the phone in front of it rather than the account, so this persists the same
 * way the theme choice does: SecureStore on a device, `localStorage` on web.
 * Ids are kept rather than a timestamp, so a notice posted while the reader was
 * looking at another tab is still new when they come back to it.
 */
export const announcementsSeenStore = {
  get: () => seen,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async restore() {
    if (restored) return seen;
    restored = true;
    try {
      seen = parse(await read());
    } catch {
      seen = [];
    }
    emit();
    return seen;
  },
  /** Records ids as read. Does nothing, and notifies nobody, when all are known. */
  async markSeen(ids: string[]) {
    const known = new Set(seen);
    const fresh = ids.filter((id) => !known.has(id));
    if (!fresh.length) return;
    seen = [...seen, ...fresh].slice(-limit);
    emit();
    try {
      await write(JSON.stringify(seen));
    } catch {
      // A device that refuses the keychain still gets it right for this run.
    }
  },
};
