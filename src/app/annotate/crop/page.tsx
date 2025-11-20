'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, Loader2 } from 'lucide-react';

// Dynamic import with SSR disabled for Fabric.js component
const CropAnnotationTool = dynamic(
  () => import('@/components/CropAnnotationTool').then((mod) => mod.CropAnnotationTool),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-white">Loading annotation tool...</span>
      </div>
    ),
  }
);

export default function CropAnnotationPage() {
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
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={`/project?orgId=${orgId}&projectId=${projectId}&env=${env}`}
            className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Project
          </Link>
          <div className="border-l border-gray-600 pl-4">
            <h1 className="text-lg font-semibold text-white">
              Edit Crop & Rotation
            </h1>
            <p className="text-xs text-gray-400">
              Project: {projectId.substring(0, 8)}... |{' '}
              <span className={env === 'prod' ? 'text-green-400' : 'text-yellow-400'}>
                {env.toUpperCase()}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Annotation tool */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen bg-gray-900">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <span className="ml-2 text-white">Loading...</span>
          </div>
        }
      >
        <CropAnnotationTool orgId={orgId} projectId={projectId} env={env} />
      </Suspense>
    </div>
  );
}
