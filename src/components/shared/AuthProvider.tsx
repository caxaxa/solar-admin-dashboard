'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { isTokenExpired, refreshAccessToken } from '@/lib/auth';

interface User {
  username: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

  useEffect(() => {
    const checkAuth = async () => {
      const accessToken = localStorage.getItem('accessToken');
      const userStr = localStorage.getItem('user');

      if (!accessToken || !userStr) {
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
    };

    checkAuth();
  }, [pathname, router]);

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
