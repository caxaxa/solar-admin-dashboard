'use client';

import { useSearchParams } from 'next/navigation';
import { use } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { PipelineView } from '@/components/PipelineView';

interface ProjectPageProps {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const { orgId, projectId } = use(params);
  const searchParams = useSearchParams();
  const env = searchParams.get('env') || 'dev';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-gray-900">
                Project: {projectId}
              </h2>
              <span
                className={`px-2 py-1 rounded text-xs font-bold ${
                  env === 'prod'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {env.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-gray-500">Organization: {orgId}</p>
          </div>
          <PipelineView orgId={orgId} projectId={projectId} env={env} />
        </main>
      </div>
    </div>
  );
}
