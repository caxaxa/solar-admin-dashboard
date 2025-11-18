import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
            <p className="text-sm text-gray-500">
              Manage application settings and preferences
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-gray-500">Settings page coming soon...</p>
          </div>
        </main>
      </div>
    </div>
  );
}
