import Link from 'next/link';
import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { FolderKanban, Zap } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">Dashboard</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select an inspection modality to manage projects
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
            <Link
              href="/thermographic/projects"
              className="group block bg-white dark:bg-gray-900 rounded-xl shadow border border-gray-200 dark:border-gray-800 p-6 hover:border-blue-400 hover:shadow-lg transition-all"
            >
              <div className="flex items-center gap-3 mb-3">
                <FolderKanban className="h-8 w-8 text-blue-500" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50 group-hover:text-blue-600">
                  Thermographic
                </h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Drone thermal inspection pipeline with ODM orthomosaic, AI defect detection, and LaTeX report generation.
              </p>
            </Link>
            <Link
              href="/el/projects"
              className="group block bg-white dark:bg-gray-900 rounded-xl shadow border border-gray-200 dark:border-gray-800 p-6 hover:border-blue-400 hover:shadow-lg transition-all"
            >
              <div className="flex items-center gap-3 mb-3">
                <Zap className="h-8 w-8 text-blue-500" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50 group-hover:text-blue-600">
                  Electroluminescence
                </h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                EL panel image inspection with AI defect detection and PDF report generation.
              </p>
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
