import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { IVProjectsList } from '@/components/iv/IVProjectsList';

export default function IVProjectsPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">IV Curve Projects</h2>
            <p className="text-sm text-gray-500">
              View and manage IV curve inspection projects
            </p>
          </div>
          <IVProjectsList />
        </main>
      </div>
    </div>
  );
}
