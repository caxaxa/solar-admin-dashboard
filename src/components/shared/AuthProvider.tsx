'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { isTokenExpired, refreshAccessToken } from '@/lib/auth';

interface User {
  username: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
}

// How often to check the access token for expiry (refresh only fires when
// the token is actually expired/about to expire — see isTokenExpired's 60s buffer).
const TOKEN_CHECK_INTERVAL_MS = 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

  // Guard so the full auth check runs once per session (on mount), not on
  // every navigation. Token refresh is handled by the expiry interval below.
  const authCheckedRef = useRef(false);

  const checkAuth = useCallback(async () => {
    const accessToken = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');

    if (!accessToken || !userStr) {
      // Preserve route guarding: never redirect-loop on the login page itself.
      if (pathname !== '/login') {
        router.push('/login');
      }
      setLoading(false);
      return;
    }

    // Auto-refresh expired tokens before proceeding
    if (isTokenExpired(accessToken)) {
      const newToken = await refreshAccessToken();
      if (!newToken) {
        localStorage.clear();
        router.push('/login');
        setLoading(false);
        return;
      }
    }

    try {
      const userData = JSON.parse(userStr);
      if (!userData.isAdmin) {
        localStorage.clear();
        router.push('/login');
        setLoading(false);
        return;
      }
      setUser(userData);
    } catch {
      localStorage.clear();
      router.push('/login');
    }

    setLoading(false);
  }, [pathname, router]);

  // Stable ref so the effects below can invoke the latest checkAuth without
  // re-running on every navigation (same pattern as ELAnnotationTool refs).
  const checkAuthRef = useRef(checkAuth);
  useEffect(() => { checkAuthRef.current = checkAuth; }, [checkAuth]);

  // Run the auth check once on mount — NOT on every route change.
  useEffect(() => {
    if (authCheckedRef.current) return;
    authCheckedRef.current = true;
    checkAuthRef.current();
  }, []);

  // The login page soft-navigates (router.push) after sign-in without
  // remounting this provider, so hydrate the user when we land on a
  // protected route without one. Once `user` is set, navigation never
  // re-triggers the check (and therefore never re-triggers a refresh).
  useEffect(() => {
    if (user || loading || pathname === '/login') return;
    checkAuthRef.current();
  }, [user, loading, pathname]);

  // Refresh the access token only when it actually expires, checked on a
  // timer instead of on every navigation.
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        localStorage.clear();
        setUser(null);
        router.push('/login');
        return;
      }
      if (isTokenExpired(accessToken)) {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          localStorage.clear();
          setUser(null);
          router.push('/login');
        }
      }
    }, TOKEN_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user, router]);

  useEffect(() => {
    if (pathname === '/login' || !user) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const logout = () => {
      localStorage.clear();
      setUser(null);
      router.push('/login');
    };

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(logout, IDLE_LIMIT_MS);
    };

    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [pathname, router, user]);

  // Don't show loading spinner on login page
  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return <>{children}</>;
}
