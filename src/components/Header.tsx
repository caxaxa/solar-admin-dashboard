'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { User, LogOut } from 'lucide-react';

export function Header() {
  const router = useRouter();
  const [displayName] = useState(() => {
    try {
      if (typeof window === 'undefined') {
        return 'Admin';
      }
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        if (parsed?.email) {
          return parsed.email as string;
        }
        if (parsed?.username) {
          return parsed.username as string;
        }
      }
    } catch {
      // swallow parse errors
    }
    return 'Admin';
  });

  const handleLogout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('idToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.push('/login');
  }, [router]);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">
            Solar Inspection Pipeline
          </h2>
          <p className="text-sm text-gray-500">
            Manage user projects and annotation workflows
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-gray-600">
            <User className="h-5 w-5" />
            <span className="text-sm font-medium truncate max-w-[14rem]">
              {displayName}
            </span>
          </div>
          <button
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-red-600 transition-colors"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
