import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, errorMessage, onSessionExpired } from '../../api/client';
import type { Envelope, UserDto } from '../../api/dtos';

type Session = { status: 'loading' | 'anonymous' } | { status: 'error'; message: string }
  | { status: 'authenticated'; user: UserDto };
interface AuthValue {
  session: Session;
  checkSession: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [check, setCheck] = useState(0);
  const generation = useRef(0);
  useEffect(() => onSessionExpired(() => {
    generation.current += 1;
    setSession({ status: 'anonymous' });
  }), []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setSession({ status: 'loading' });
    void api.get<Envelope<UserDto>>('/auth/me', { signal: controller.signal, ignoreUnauthorized: true })
      .then(({ data }) => {
        if (current === generation.current) setSession({ status: 'authenticated', user: data });
      }).catch((error: unknown) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setSession(error instanceof ApiError && error.status === 401
          ? { status: 'anonymous' } : { status: 'error', message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [check]);
  const login = useCallback(async (email: string, password: string) => {
    const current = ++generation.current;
    const { data } = await api.post<Envelope<UserDto>>('/auth/login', { email, password }, { ignoreUnauthorized: true });
    if (current === generation.current) setSession({ status: 'authenticated', user: data });
  }, []);
  const logout = useCallback(async () => {
    try { await api.post<void>('/auth/logout'); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    generation.current += 1;
    setSession({ status: 'anonymous' });
  }, []);
  return <AuthContext.Provider value={{ session, checkSession: () => setCheck((value) => value + 1), login, logout }}>
    {children}
  </AuthContext.Provider>;
}
export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}
