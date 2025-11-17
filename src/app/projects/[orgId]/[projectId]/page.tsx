import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { PipelineView } from '@/components/PipelineView';

interface ProjectPageProps {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { orgId, projectId } = await params;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              Project: {projectId}
            </h2>
            <p className="text-sm text-gray-500">
              Organization: {orgId}
            </p>
          </div>
          <PipelineView orgId={orgId} projectId={projectId} />
        </main>
      </div>
    </div>
  );
}
