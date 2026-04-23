'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FolderKanban, Settings, Sun, Cpu, Zap, Activity, Receipt } from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  // Thermographic
  { href: '/thermographic/projects', label: 'Thermographic Projects', icon: FolderKanban },
  { href: '/thermographic/model', label: 'Thermographic AI Model', icon: Cpu },
  // Electroluminescence
  { href: '/el/projects', label: 'EL Projects', icon: Zap },
  { href: '/el/model', label: 'EL AI Model', icon: Cpu },
  // IV Curve
  { href: '/iv/projects', label: 'IV Curve Projects', icon: Activity },
  // Billing
  { href: '/billing', label: 'Billing & Revenue', icon: Receipt },
  // Settings
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:block w-64 bg-gray-900 text-white min-h-screen p-4">
      <div className="flex items-center gap-2 mb-8">
        <Sun className="h-8 w-8 text-yellow-400" />
        <h1 className="text-xl font-bold">Solar Admin</h1>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
