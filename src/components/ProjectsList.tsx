'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FolderOpen, ChevronRight, Loader2 } from 'lucide-react';

interface Project {
  orgId: string;
  projectId: string;
}

export function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error('Failed to fetch projects');
        const data = await response.json();
        setProjects(data.projects);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    }

    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading projects...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <FolderOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900">No projects found</h3>
        <p className="text-gray-500 mt-2">
          Projects will appear here when users create them.
        </p>
      </div>
    );
  }

  // Group projects by organization
  const projectsByOrg: Record<string, string[]> = {};
  projects.forEach(({ orgId, projectId }) => {
    if (!projectsByOrg[orgId]) {
      projectsByOrg[orgId] = [];
    }
    projectsByOrg[orgId].push(projectId);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          All Projects ({projects.length})
        </h3>
      </div>

      <div className="space-y-4">
        {Object.entries(projectsByOrg).map(([orgId, orgProjects]) => (
          <div key={orgId} className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 bg-gray-50 border-b rounded-t-lg">
              <h4 className="font-medium text-gray-700">
                Organization: {orgId.substring(0, 8)}...
              </h4>
              <p className="text-sm text-gray-500">
                {orgProjects.length} project(s)
              </p>
            </div>

            <div className="divide-y">
              {orgProjects.map((projectId) => (
                <Link
                  key={projectId}
                  href={`/projects/${orgId}/${projectId}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <FolderOpen className="h-5 w-5 text-blue-500" />
                    <span className="font-mono text-sm">{projectId}</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
