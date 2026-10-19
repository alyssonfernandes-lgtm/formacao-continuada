import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrf } from './api';
import { hexToRgb, readableOn, setTimezone } from './format';
import type { Permission, Role } from '../../shared/types';

export interface PublicSettings {
  platformName: string;
  municipality: string;
  department: string;
  primaryColor: string;
  secondaryColor: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  timezone: string;
  hasLogo: boolean;
  logoVersion: string | null;
  controllerName: string;
  dpoName: string;
  dpoContact: string;
  privacyExtra: string;
  retentionCancelledDays: number;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
}

interface Ctx {
  settings: PublicSettings | null;
  reloadSettings: () => Promise<void>;
  me: Me | null;
  permissions: Permission[];
  authLoaded: boolean;
  setSession: (d: { user: Me | null; csrfToken?: string; permissions?: Permission[] }) => void;
  refreshMe: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);

export function applyTheme(s: PublicSettings) {
  const r = document.documentElement.style;
  r.setProperty('--c-primary', hexToRgb(s.primaryColor).join(' '));
  r.setProperty('--c-primary-fg', readableOn(s.primaryColor));
  r.setProperty('--c-secondary', hexToRgb(s.secondaryColor).join(' '));
  r.setProperty('--c-secondary-fg', readableOn(s.secondaryColor));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.primaryColor);
  setTimezone(s.timezone);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [authLoaded, setAuthLoaded] = useState(false);

  const reloadSettings = useCallback(async () => {
    const s = await api<PublicSettings>('/api/public/settings');
    applyTheme(s);
    setSettings(s);
  }, []);

  const setSession = useCallback((d: { user: Me | null; csrfToken?: string; permissions?: Permission[] }) => {
    setMe(d.user);
    setPermissions(d.permissions ?? []);
    setCsrf(d.csrfToken ?? '');
    setAuthLoaded(true);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      setSession(await api('/api/auth/me'));
    } catch {
      setSession({ user: null });
    }
  }, [setSession]);

  useEffect(() => {
    reloadSettings().catch(() => undefined);
    const onExpired = () => setSession({ user: null });
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, [reloadSettings, setSession]);

  const value = useMemo<Ctx>(
    () => ({ settings, reloadSettings, me, permissions, authLoaded, setSession, refreshMe, can: (p) => permissions.includes(p) }),
    [settings, reloadSettings, me, permissions, authLoaded, setSession, refreshMe],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);

export function useTitle(title: string) {
  const { settings } = useApp();
  useEffect(() => {
    document.title = `${title} · ${settings?.platformName ?? 'Formação Continuada'}`;
  }, [title, settings?.platformName]);
}
