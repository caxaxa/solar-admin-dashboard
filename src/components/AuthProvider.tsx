'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';

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

  useEffect(() => {
    const checkAuth = () => {
      const accessToken = localStorage.getItem('accessToken');
      const userStr = localStorage.getItem('user');

      if (!accessToken || !userStr) {
        if (pathname !== '/login') {
          router.push('/login');
        }
        setLoading(false);
        return;
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
    return null;
  }

  return <>{children}</>;
}
