'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

const ELAnnotationTool = dynamic(
  () => import('@/components/el/ELAnnotationTool').then((mod) => ({ default: mod.ELAnnotationTool })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-300">Loading annotation tool...</p>
        </div>
      </div>
    )
  }
);

function ELDefectsContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId');
  const projectId = searchParams.get('projectId');
  const env = searchParams.get('env') || 'dev';

  if (!orgId || !projectId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-gray-800 rounded-lg p-6 text-center space-y-4">
          <p className="text-white">Missing project context.</p>
          <Link href="/el/projects" className="text-blue-400 hover:underline">
            Back to EL project list
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/el/project?orgId=${orgId}&projectId=${projectId}&env=${env}`}
              className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back to Pipeline</span>
            </Link>
            <div className="h-6 w-px bg-gray-600" />
            <h1 className="text-lg font-semibold text-white">
              EL Defect Review
            </h1>
          </div>
          <div className="text-sm text-gray-400">
            Project: {projectId.substring(0, 12)}... |{' '}
            <span className={env === 'prod' ? 'text-green-400' : 'text-yellow-400'}>
              {env.toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      <main className="h-[calc(100vh-60px)]">
        <ELAnnotationTool orgId={orgId} projectId={projectId} env={env} />
      </main>
    </div>
  );
}

export default function ELDefectsAnnotationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <ELDefectsContent />
    </Suspense>
  );
}
