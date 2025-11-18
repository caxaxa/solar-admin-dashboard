'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FolderOpen, ChevronRight, Loader2 } from 'lucide-react';

interface Project {
  orgId: string;
  projectId: string;
  environment: 'dev' | 'prod';
}

interface OrgInfo {
  email: string;
}

export function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizations, setOrganizations] = useState<Record<string, OrgInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error('Failed to fetch projects');
        const data = await response.json();
        setProjects(data.projects);
        setOrganizations(data.organizations || {});
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

  // Group projects by environment then organization
  const projectsByEnvAndOrg: Record<string, Record<string, Project[]>> = {
    prod: {},
    dev: {},
  };

  projects.forEach((project) => {
    const { orgId, environment } = project;
    if (!projectsByEnvAndOrg[environment][orgId]) {
      projectsByEnvAndOrg[environment][orgId] = [];
    }
    projectsByEnvAndOrg[environment][orgId].push(project);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">
          All Projects ({projects.length})
        </h3>
      </div>

      {/* Production Projects */}
      <div className="space-y-4">
        <h4 className="text-md font-semibold text-gray-800 flex items-center gap-2">
          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold">
            PRODUCTION
          </span>
          <span className="text-gray-500 text-sm">
            ({Object.values(projectsByEnvAndOrg.prod).flat().length} projects)
          </span>
        </h4>

        {Object.entries(projectsByEnvAndOrg.prod).length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-4 text-gray-500 text-sm">
            No production projects found
          </div>
        ) : (
          Object.entries(projectsByEnvAndOrg.prod).map(([orgId, orgProjects]) => (
            <div key={`prod-${orgId}`} className="bg-white rounded-lg shadow border-l-4 border-green-500">
              <div className="px-4 py-3 bg-gray-50 border-b rounded-t-lg">
                <h4 className="font-medium text-gray-700">
                  {organizations[orgId]?.email || orgId}{' '}
                  <span className="text-gray-400 text-sm">
                    ({orgId.substring(0, 8)}...)
                  </span>
                </h4>
                <p className="text-sm text-gray-500">
                  {orgProjects.length} project(s)
                </p>
              </div>

              <div className="divide-y">
                {orgProjects.map((project) => (
                  <Link
                    key={project.projectId}
                    href={`/projects/${project.orgId}/${project.projectId}?env=prod`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-5 w-5 text-green-500" />
                      <span className="font-mono text-sm">{project.projectId}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600" />
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Development Projects */}
      <div className="space-y-4">
        <h4 className="text-md font-semibold text-gray-800 flex items-center gap-2">
          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-bold">
            DEVELOPMENT
          </span>
          <span className="text-gray-500 text-sm">
            ({Object.values(projectsByEnvAndOrg.dev).flat().length} projects)
          </span>
        </h4>

        {Object.entries(projectsByEnvAndOrg.dev).length === 0 ? (
          <div className="bg-gray-50 rounded-lg p-4 text-gray-500 text-sm">
            No development projects found
          </div>
        ) : (
          Object.entries(projectsByEnvAndOrg.dev).map(([orgId, orgProjects]) => (
            <div key={`dev-${orgId}`} className="bg-white rounded-lg shadow border-l-4 border-yellow-500">
              <div className="px-4 py-3 bg-gray-50 border-b rounded-t-lg">
                <h4 className="font-medium text-gray-700">
                  {organizations[orgId]?.email || orgId}{' '}
                  <span className="text-gray-400 text-sm">
                    ({orgId.substring(0, 8)}...)
                  </span>
                </h4>
                <p className="text-sm text-gray-500">
                  {orgProjects.length} project(s)
                </p>
              </div>

              <div className="divide-y">
                {orgProjects.map((project) => (
                  <Link
                    key={project.projectId}
                    href={`/projects/${project.orgId}/${project.projectId}?env=dev`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-5 w-5 text-yellow-500" />
                      <span className="font-mono text-sm">{project.projectId}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600" />
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
