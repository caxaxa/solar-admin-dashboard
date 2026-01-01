'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { User, LogOut, Home, FolderKanban, Settings as SettingsIcon, Cpu } from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/model', label: 'AI Model', icon: Cpu },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
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
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 sm:px-6 py-4">
      <div className="flex items-start sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
            Solar Inspection Pipeline
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-300">
            Manage user projects and annotation workflows
          </p>
          <div className="mt-2 flex md:hidden gap-2 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm whitespace-nowrap ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-200">
            <User className="h-5 w-5" />
            <span className="text-sm font-medium truncate max-w-[14rem]">
              {displayName}
            </span>
          </div>
          <button
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-200 hover:text-red-600 transition-colors"
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
