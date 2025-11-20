'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

const AnnotationTool = dynamic(
  () => import('@/components/AnnotationTool').then((mod) => ({ default: mod.AnnotationTool })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-300">Loading canvas...</p>
        </div>
      </div>
    )
  }
);

function DefectsContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId');
  const projectId = searchParams.get('projectId');
  const env = searchParams.get('env') || 'dev';

  if (!orgId || !projectId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-gray-800 rounded-lg p-6 text-center space-y-4">
          <p className="text-white">Missing project context.</p>
          <Link href="/projects" className="text-blue-400 hover:underline">
            Back to project list
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
              href={`/project?orgId=${orgId}&projectId=${projectId}&env=${env}`}
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
            Project: {projectId.substring(0, 12)}... |{' '}
            <span className={env === 'prod' ? 'text-green-400' : 'text-yellow-400'}>
              {env.toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      <main className="h-[calc(100vh-60px)]">
        <AnnotationTool orgId={orgId} projectId={projectId} env={env} />
      </main>
    </div>
  );
}

export default function DefectsAnnotationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <DefectsContent />
    </Suspense>
  );
}
