'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FolderOpen, ChevronRight, Loader2, Plus, Play, Clock, Upload, Trash2 } from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';
import { CreateProjectModal } from '../shared/CreateProjectModal';

interface Project {
  orgId: string;
  projectId: string;
  environment: 'dev' | 'prod';
  projectName?: string;
  status?: string;
  releaseStatus?: string;
  stages?: Record<string, any>;
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
  stages?: Record<string, any>;
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
      const response = await fetch(buildApiUrl('/projects?type=thermographic'));
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
      const response = await fetch(
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
      const response = await fetch(
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
    const thermoReportStatus = (project as any)?.stages?.thermo_report?.status;
    const thermoReportFailed = thermoReportStatus === 'FAILED';
    const hasReleaseError =
      project.releaseStatus === 'error' ||
      project.status === 'release_error' ||
      project.status === 'release_failed' ||
      thermoReportFailed;

    if (hasReleaseError) {
      return { text: 'Falha na liberação', color: 'bg-red-100 text-red-800' };
    }

    const isReleased =
      (project as any)?.isReleased === true || thermoReportStatus === 'COMPLETED';

    if (project.status === 'failed' || project.status === 'validation_failed') {
      return { text: 'Falhou', color: 'bg-red-100 text-red-800' };
    }

    if (isReleased) {
      return { text: 'Concluído', color: 'bg-green-100 text-green-800' };
    }

    if (project.status === 'completed') {
      return { text: 'Processando Relatório', color: 'bg-purple-100 text-purple-800' };
    }

    const statusMap: Record<string, { text: string; color: string }> = {
      creating: { text: 'Criando', color: 'bg-gray-100 text-gray-800' },
      uploading: { text: 'Enviando', color: 'bg-blue-100 text-blue-800' },
      validating: { text: 'Validando', color: 'bg-yellow-100 text-yellow-800' },
      processing: { text: 'Processando', color: 'bg-purple-100 text-purple-800' },
      processing_odm: { text: 'Processando ODM', color: 'bg-purple-100 text-purple-800' },
      deleted: { text: 'Deletado', color: 'bg-gray-200 text-gray-800' },
    };

    return statusMap[project.status || ''] || { text: 'Processando', color: 'bg-gray-100 text-gray-800' };
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
                {status === 'all' ? 'Todos' : status}
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
          <h4 className="text-md font-semibold text-gray-800 flex items-center gap-2">
            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs font-bold">
              PENDING PROCESSING
            </span>
            <span className="text-gray-500 text-sm">
              ({filteredPending.length} project{filteredPending.length !== 1 ? 's' : ''})
            </span>
          </h4>

          <div className="bg-white rounded-lg shadow border-l-4 border-orange-500">
            <div className="divide-y">
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
                    className="px-4 py-4 hover:bg-orange-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <Upload className="h-5 w-5 text-orange-500" />
                          <span className="font-medium text-gray-900">
                            {project.projectName}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getDisplayStatus(project).color}`}>
                            {getDisplayStatus(project).text}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            project.environment === 'prod' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {project.environment}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-gray-500 ml-8">
                          <span className="font-mono text-xs">{project.projectId}</span>
                          {' • '}
                          {project.fileCount} files
                          {project.totalSizeBytes > 0 && ` • ${formatBytes(project.totalSizeBytes)}`}
                          {' • '}
                          <Clock className="inline h-3 w-3" /> {formatDate(project.createdAt)}
                        </div>
                        {project.description && (
                          <div className="mt-1 text-sm text-gray-400 ml-8">
                            {project.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {canStartOdm && (
                          <button
                            onClick={() => handleStartOdm(project)}
                            disabled={isLoading || isDeleting}
                            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                          >
                            {isLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            Gerar Relatório
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteProject(project)}
                            disabled={isLoading || isDeleting}
                            className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
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
                          <span className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-lg">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Processing...
                          </span>
                        )}
                        <Link
                          href={`/thermographic/project?orgId=${project.orgId}&projectId=${project.projectId}&env=${project.environment}`}
                          className="p-2 text-gray-400 hover:text-blue-600"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Link>
                      </div>
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
        <h4 className="text-md font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold">
            PRODUCTION
          </span>
          <span className="text-gray-500 dark:text-gray-300 text-sm">
            ({Object.values(projectsByEnvAndOrg.prod).flat().length} projects)
          </span>
        </h4>

        {Object.entries(projectsByEnvAndOrg.prod).length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-gray-500 dark:text-gray-300 text-sm">
            No production projects found
          </div>
        ) : (
          Object.entries(projectsByEnvAndOrg.prod).map(([orgId, orgProjects]) => (
            <div key={`prod-${orgId}`} className="bg-white dark:bg-gray-900 rounded-lg shadow border-l-4 border-green-500">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-800 rounded-t-lg">
                <h4 className="font-medium text-gray-700 dark:text-gray-100">
                  {organizations[orgId]?.email || orgId}{' '}
                  <span className="text-gray-400 dark:text-gray-300 text-sm">
                    ({orgId.substring(0, 8)}...)
                  </span>
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-300">
                  {orgProjects.length} project(s)
                </p>
              </div>

              <div className="divide-y">
                {orgProjects.map((project) => {
                  const statusInfo = getDisplayStatus(project);
                  return (
                    <Link
                      key={project.projectId}
                      href={`/thermographic/project?orgId=${project.orgId}&projectId=${project.projectId}&env=prod`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-green-500" />
                        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {project.projectName || project.projectId}
                          </span>
                          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                            {project.projectId}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.text}
                        </span>
                        <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-300" />
                      </div>
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
        <h4 className="text-md font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-bold">
            DEVELOPMENT
          </span>
          <span className="text-gray-500 dark:text-gray-300 text-sm">
            ({Object.values(projectsByEnvAndOrg.dev).flat().length} projects)
          </span>
        </h4>

        {Object.entries(projectsByEnvAndOrg.dev).length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-gray-500 dark:text-gray-300 text-sm">
            No development projects found
          </div>
        ) : (
          Object.entries(projectsByEnvAndOrg.dev).map(([orgId, orgProjects]) => (
            <div key={`dev-${orgId}`} className="bg-white dark:bg-gray-900 rounded-lg shadow border-l-4 border-yellow-500">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-800 rounded-t-lg">
                <h4 className="font-medium text-gray-700 dark:text-gray-100">
                  {organizations[orgId]?.email || orgId}{' '}
                  <span className="text-gray-400 dark:text-gray-300 text-sm">
                    ({orgId.substring(0, 8)}...)
                  </span>
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-300">
                  {orgProjects.length} project(s)
                </p>
              </div>

              <div className="divide-y">
                {orgProjects.map((project) => {
                  const statusInfo = getDisplayStatus(project);
                  return (
                    <Link
                      key={project.projectId}
                      href={`/thermographic/project?orgId=${project.orgId}&projectId=${project.projectId}&env=dev`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-yellow-500" />
                        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {project.projectName || project.projectId}
                          </span>
                          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                            {project.projectId}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.text}
                        </span>
                        <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-300" />
                      </div>
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
