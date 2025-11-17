import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { ProjectsList } from '@/components/ProjectsList';

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <ProjectsList />
        </main>
      </div>
    </div>
  );
}
