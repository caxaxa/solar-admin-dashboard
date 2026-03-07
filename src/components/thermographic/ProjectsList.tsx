'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FolderOpen, ChevronRight, Loader2, Plus, Play, Clock, Trash2 } from 'lucide-react';
import { buildApiUrl, apiFetch } from '@/lib/api-client';
import { CreateProjectModal } from '../shared/CreateProjectModal';

interface Project {
  orgId: string;
  projectId: string;
  environment: 'dev' | 'prod';
  projectName?: string;
  status?: string;
  releaseStatus?: string;
  stages?: Record<string, unknown>;
  isReleased?: boolean;
}

interface PendingProject {
  orgId: string;
  projectId: string;
  projectName: string;
  description?: string;
  status: string;
  statusMessage?: string;
  fileCount: number;
  totalSizeBytes: number;
  createdAt: number;
  environment: 'dev' | 'prod';
  releaseStatus?: string;
  stages?: Record<string, unknown>;
  isReleased?: boolean;
}

interface OrgInfo {
  email: string;
}

export function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingProjects, setPendingProjects] = useState<PendingProject[]>([]);
  const [organizations, setOrganizations] = useState<Record<string, OrgInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>(['all']);

  // Load persisted filter on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('adminStatusFilter');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setStatusFilter(parsed);
        }
      } catch {
        /* ignore parse errors and keep default */
      }
    }
  }, []);

  // Persist filter changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('adminStatusFilter', JSON.stringify(statusFilter));
  }, [statusFilter]);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch(buildApiUrl('/projects?type=thermographic'));
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data.projects);
      setPendingProjects(data.pendingProjects || []);
      setOrganizations(data.organizations || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStartOdm = async (project: PendingProject) => {
    const key = `${project.environment}-${project.projectId}`;
    setActionLoading(key);
    try {
      const response = await apiFetch(
        buildApiUrl(`/projects/${project.orgId}/${project.projectId}/start-odm?env=${project.environment}`),
        { method: 'POST' }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Failed to start ODM processing');
      }
      const data = await response.json();

      if (data.status === 'already_processing') {
        alert(`Project already processing!\n\nExecution: ${data.executionArn?.split(':').pop() || 'unknown'}`);
      } else {
        alert(`ODM processing started successfully!\n\nProject: ${project.projectName}\nFiles: ${data.fileCount}\nSize: ${data.totalSizeMb} MB\nInstance: ${data.instanceType}`);
      }

      // Refresh projects list
      await fetchProjects();
    } catch (err) {
      console.error('Failed to start ODM:', err);
      alert(`Failed to start ODM: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteProject = async (project: PendingProject) => {
    const confirmMessage = `Are you sure you want to delete project "${project.projectName}"?\n\nThis will delete ${project.fileCount} uploaded files and cannot be undone.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    const key = `delete-${project.environment}-${project.projectId}`;
    setActionLoading(key);
    try {
      const response = await apiFetch(
        buildApiUrl(`/projects/${project.orgId}/${project.projectId}/actions/delete?env=${project.environment}`),
        { method: 'POST' }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Failed to delete project');
      }
      const data = await response.json();

      alert(`Project deleted successfully!\n\nDeleted ${data.deletedFiles} files and ${data.deletedRecords} database records.`);

      // Refresh projects list
      await fetchProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert(`Failed to delete project: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const getDisplayStatus = (project: Partial<Project> | PendingProject) => {
    const stages = project.stages as Record<string, Record<string, unknown>> | undefined;
    const thermoReportStatus = stages?.thermo_report?.status;
    const thermoReportFailed = thermoReportStatus === 'FAILED';
    const hasReleaseError =
      project.releaseStatus === 'error' ||
      project.status === 'release_error' ||
      project.status === 'release_failed' ||
      thermoReportFailed;

    if (hasReleaseError) {
      return { text: 'Release Failed', color: 'bg-red-100 text-red-800' };
    }

    const isReleased =
      ('isReleased' in project && project.isReleased === true) || thermoReportStatus === 'COMPLETED';

    if (project.status === 'failed' || project.status === 'validation_failed') {
      return { text: 'Failed', color: 'bg-red-100 text-red-800' };
    }

    if (isReleased) {
      return { text: 'Completed', color: 'bg-green-100 text-green-800' };
    }

    if (project.status === 'completed') {
      return { text: 'Processing Report', color: 'bg-blue-100 text-blue-800' };
    }

    const statusMap: Record<string, { text: string; color: string }> = {
      creating: { text: 'Creating', color: 'bg-gray-100 text-gray-800' },
      uploading: { text: 'Uploading', color: 'bg-blue-100 text-blue-800' },
      validating: { text: 'Validating', color: 'bg-yellow-100 text-yellow-800' },
      processing: { text: 'Processing', color: 'bg-blue-100 text-blue-800' },
      processing_odm: { text: 'Processing ODM', color: 'bg-blue-100 text-blue-800' },
      deleted: { text: 'Deleted', color: 'bg-gray-200 text-gray-800' },
    };

    return statusMap[project.status || ''] || { text: 'Processing', color: 'bg-gray-100 text-gray-800' };
  };

  const filteredPending = pendingProjects.filter((p) => {
    if (statusFilter.includes('all')) return true;
    return statusFilter.includes(getDisplayStatus(p).text);
  });

  const filterProjectsByStatus = (projectList: Project[]) => {
    if (statusFilter.includes('all')) return projectList;
    return projectList.filter((p) => statusFilter.includes(getDisplayStatus(p).text));
  };

  const availableStatusFilters = () => {
    const statuses = new Set<string>();
    [...projects, ...pendingProjects].forEach((p) => statuses.add(getDisplayStatus(p).text));
    return ['all', ...Array.from(statuses)];
  };

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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

  if (projects.length === 0 && pendingProjects.length === 0) {
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

  const filteredProjects = filterProjectsByStatus(projects);

  // Group projects by environment then organization
  const projectsByEnvAndOrg: Record<string, Record<string, Project[]>> = {
    prod: {},
    dev: {},
  };

  filteredProjects.forEach((project) => {
    const { orgId, environment } = project;
    if (!projectsByEnvAndOrg[environment][orgId]) {
      projectsByEnvAndOrg[environment][orgId] = [];
    }
    projectsByEnvAndOrg[environment][orgId].push(project);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-50">
          All Projects ({filteredProjects.length}{!statusFilter.includes('all') ? ` of ${projects.length}` : ''})
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {availableStatusFilters().map((status) => (
              <label key={status} className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={statusFilter.includes(status)}
                  onChange={(e) => {
                    if (status === 'all') {
                      setStatusFilter(['all']);
                      return;
                    }
                    const next = new Set(statusFilter.filter((s) => s !== 'all'));
                    if (e.target.checked) {
                      next.add(status);
                    } else {
                      next.delete(status);
                    }
                    setStatusFilter(next.size === 0 ? ['all'] : Array.from(next));
                  }}
                  className="h-4 w-4"
                />
                {status === 'all' ? 'All' : status}
              </label>
            ))}
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Project
          </button>
        </div>
      </div>

      {showCreateModal && (
        <CreateProjectModal
          organizations={organizations}
          onClose={() => setShowCreateModal(false)}
          onSuccess={fetchProjects}
        />
      )}

      {/* Pending Projects - Need Processing */}
      {filteredPending.length > 0 && (
        <div className="space-y-4">

          <div className="border-2 border-orange-200 rounded-lg p-4 bg-orange-50">
            <h3 className="text-sm font-semibold text-orange-800 mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending ({filteredPending.length})
            </h3>
            <div className="space-y-3">
              {filteredPending.map((project) => {
                const key = `${project.environment}-${project.projectId}`;
                const deleteKey = `delete-${project.environment}-${project.projectId}`;
                const isLoading = actionLoading === key;
                const isDeleting = actionLoading === deleteKey;
                const canStartOdm = project.status === 'uploading' && project.fileCount > 0;
                const canDelete = ['creating', 'uploading', 'validating'].includes(project.status);

                return (
                  <div
                    key={key}
                    className="bg-white rounded-lg p-4 border border-orange-100 flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {project.projectName}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getDisplayStatus(project).color}`}>
                          {getDisplayStatus(project).text}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          project.environment === 'prod' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {project.environment.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {project.fileCount} files
                        {project.totalSizeBytes > 0 && ` · ${formatBytes(project.totalSizeBytes)}`}
                        {' · '}
                        {formatDate(project.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {canStartOdm && (
                        <button
                          onClick={() => handleStartOdm(project)}
                          disabled={isLoading || isDeleting}
                          className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          Generate Report
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDeleteProject(project)}
                          disabled={isLoading || isDeleting}
                          className="p-2 text-red-500 hover:bg-red-50 rounded"
                          title="Delete pending project"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      {project.status === 'processing' && (
                        <span className="flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-800 rounded-lg text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing...
                        </span>
                      )}
                      <Link
                        href={`/thermographic/project?orgId=${project.orgId}&projectId=${project.projectId}&env=${project.environment}`}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Production Projects */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-green-800 mb-3">
          Production ({Object.values(projectsByEnvAndOrg.prod).flat().length})
        </h3>

        {Object.entries(projectsByEnvAndOrg.prod).length === 0 ? (
          <div className="text-sm text-gray-500">No production projects found</div>
        ) : (
          Object.entries(projectsByEnvAndOrg.prod).map(([orgId, orgProjects]) => (
            <div key={`prod-${orgId}`} className="border-2 border-green-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-2">
                {organizations[orgId]?.email || orgId.substring(0, 12) + '...'}
              </div>
              <div className="space-y-2">
                {orgProjects.map((project) => {
                  const statusInfo = getDisplayStatus(project);
                  return (
                    <Link
                      key={project.projectId}
                      href={`/thermographic/project?orgId=${project.orgId}&projectId=${project.projectId}&env=prod`}
                      className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-100 hover:border-blue-300 transition-colors"
                    >
                      <FolderOpen className="h-5 w-5 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 truncate block">
                          {project.projectName || project.projectId}
                        </span>
                        <span className="text-xs text-gray-500">{project.projectId.substring(0, 12)}...</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}>
                        {statusInfo.text}
                      </span>
                      <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Development Projects */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-yellow-800 mb-3">
          Development ({Object.values(projectsByEnvAndOrg.dev).flat().length})
        </h3>

        {Object.entries(projectsByEnvAndOrg.dev).length === 0 ? (
          <div className="text-sm text-gray-500">No development projects found</div>
        ) : (
          Object.entries(projectsByEnvAndOrg.dev).map(([orgId, orgProjects]) => (
            <div key={`dev-${orgId}`} className="border-2 border-yellow-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-2">
                {organizations[orgId]?.email || orgId.substring(0, 12) + '...'}
              </div>
              <div className="space-y-2">
                {orgProjects.map((project) => {
                  const statusInfo = getDisplayStatus(project);
                  return (
                    <Link
                      key={project.projectId}
                      href={`/thermographic/project?orgId=${project.orgId}&projectId=${project.projectId}&env=dev`}
                      className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-100 hover:border-blue-300 transition-colors"
                    >
                      <FolderOpen className="h-5 w-5 text-blue-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 truncate block">
                          {project.projectName || project.projectId}
                        </span>
                        <span className="text-xs text-gray-500">{project.projectId.substring(0, 12)}...</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}>
                        {statusInfo.text}
                      </span>
                      <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
