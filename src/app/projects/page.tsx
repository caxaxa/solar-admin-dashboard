import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { ProjectsList } from '@/components/ProjectsList';

export default function ProjectsPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Projects</h2>
            <p className="text-sm text-gray-500">
              View and manage all projects across environments
            </p>
          </div>
          <ProjectsList />
        </main>
      </div>
    </div>
  );
}
