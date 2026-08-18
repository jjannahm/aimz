import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/src/lib/api';
import { sessionStore } from '@/src/lib/session';
import type { TokenResponse, User } from '@/src/types/api';

type AuthContextValue = {
  isReady: boolean;
  user: User | null;
  signIn(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string, inviteCode: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<TokenResponse | null>(sessionStore.get());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const unsubscribe = sessionStore.subscribe(setSession);
    sessionStore.restore().finally(() => setIsReady(true));
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    isReady,
    user: session?.user ?? null,
    async signIn(email, password) {
      await api.waitUntilReady();
      await sessionStore.save(await api.login(email.trim().toLowerCase(), password));
    },
    async register(name, email, password, inviteCode) {
      await api.waitUntilReady();
      await sessionStore.save(await api.register(name.trim(), email.trim().toLowerCase(), password, inviteCode.trim()));
    },
    async signOut() {
      const current = sessionStore.get();
      await sessionStore.clear();
      if (current) await api.logout(current.refresh_token).catch(() => undefined);
    },
  }), [isReady, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
