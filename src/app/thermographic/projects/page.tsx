import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { ProjectsList } from '@/components/thermographic/ProjectsList';

export default function ThermographicProjectsPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Thermographic Projects</h2>
            <p className="text-sm text-gray-500">
              View and manage thermographic inspection projects
            </p>
          </div>
          <ProjectsList />
        </main>
      </div>
    </div>
  );
}
