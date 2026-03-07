'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { ThermalAnnotationTool } from '@/components/thermographic/ThermalAnnotationTool';
import Link from 'next/link';

function ThermalAnnotationContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId');
  const projectId = searchParams.get('projectId');
  const env = searchParams.get('env') || 'dev';

  if (!orgId || !projectId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white shadow rounded-lg p-10 text-center space-y-4">
          <p className="text-gray-700">Missing project context.</p>
          <Link href="/thermographic/projects" className="text-blue-600 hover:underline">
            Back to project list
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Link
              href={`/thermographic/project?orgId=${orgId}&projectId=${projectId}&env=${env}`}
              className="text-gray-400 hover:text-gray-200 text-sm"
            >
              ← Back to Project
            </Link>
            <span className="text-gray-600">|</span>
            <h2 className="text-lg font-semibold text-white">
              Thermal Annotation Override
            </h2>
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold ${
                env === 'prod'
                  ? 'bg-green-600 text-white'
                  : 'bg-yellow-600 text-white'
              }`}
            >
              {env.toUpperCase()}
            </span>
          </div>
        </div>
        <main className="flex-1 overflow-hidden">
          <ThermalAnnotationTool orgId={orgId} projectId={projectId} env={env} />
        </main>
      </div>
    </div>
  );
}

export default function ThermalAnnotationPage() {
  return (
    <Suspense>
      <ThermalAnnotationContent />
    </Suspense>
  );
}
