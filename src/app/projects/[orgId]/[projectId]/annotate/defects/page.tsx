'use client';

import { use } from 'react';
import { AnnotationTool } from '@/components/AnnotationTool';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface DefectsPageProps {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export default function DefectsAnnotationPage({ params }: DefectsPageProps) {
  const { orgId, projectId } = use(params);

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/projects/${orgId}/${projectId}`}
              className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back to Pipeline</span>
            </Link>
            <div className="h-6 w-px bg-gray-600" />
            <h1 className="text-lg font-semibold text-white">
              Defect Detection Review
            </h1>
          </div>
          <div className="text-sm text-gray-400">
            Project: {projectId.substring(0, 12)}...
          </div>
        </div>
      </header>

      <main className="h-[calc(100vh-60px)]">
        <AnnotationTool orgId={orgId} projectId={projectId} />
      </main>
    </div>
  );
}
