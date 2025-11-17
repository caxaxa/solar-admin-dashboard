'use client';

import { User, LogOut } from 'lucide-react';

export function Header() {
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
            <span className="text-sm font-medium">Admin</span>
          </div>
          <button
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-red-600 transition-colors"
            onClick={() => {
              // TODO: Implement logout
              console.log('Logout clicked');
            }}
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
