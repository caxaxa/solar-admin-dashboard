'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FolderOpen, ChevronRight, Loader2, Plus, Clock, Trash2 } from 'lucide-react';
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
  projectType?: string;
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
  projectType?: string;
}

interface Organizations {
  [orgId: string]: { email: string };
}

const STATUS_LABELS: Record<string, string> = {
  creating: 'Creating',
  uploading: 'Uploading',
  validating: 'Validating',
  ready: 'Ready',
  detecting: 'Running Detections',
  reviewing: 'In Review',
  generating_report: 'Generating Report',
  completed: 'Completed',
  failed: 'Failed',
  released: 'Released',
  deleted: 'Deleted',
};

const STATUS_COLORS: Record<string, string> = {
  creating: 'bg-gray-100 text-gray-700',
  uploading: 'bg-blue-100 text-blue-700',
  validating: 'bg-yellow-100 text-yellow-700',
  ready: 'bg-green-100 text-green-700',
  detecting: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-orange-100 text-orange-700',
  generating_report: 'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-700',
  released: 'bg-emerald-100 text-emerald-800',
  deleted: 'bg-gray-100 text-gray-500',
};

export function ELProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingProjects, setPendingProjects] = useState<PendingProject[]>([]);
  const [organizations, setOrganizations] = useState<Organizations>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const resp = await apiFetch(buildApiUrl('/projects?type=el'));
      if (!resp.ok) throw new Error('Failed to fetch EL projects');
      const data = await resp.json();
      setProjects(data.projects || []);
      setPendingProjects(data.pendingProjects || []);
      setOrganizations(data.organizations || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleDeleteProject = async (orgId: string, projectId: string, env: string) => {
    if (!confirm('Delete this EL project? This cannot be undone.')) return;
    setActionLoading(true);
    try {
      const resp = await apiFetch(
        buildApiUrl(`/el/projects/${orgId}/${projectId}/actions/delete?env=${env}`),
        { method: 'POST' }
      );
      if (!resp.ok) throw new Error('Failed to delete project');
      await fetchProjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (ts: number): string =>
    new Date(ts * 1000).toLocaleString();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading EL projects...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
        {error}
      </div>
    );
  }

  const prodProjects = projects.filter((p) => p.environment === 'prod');
  const devProjects = projects.filter((p) => p.environment === 'dev');

  const projectsByOrg = (list: Project[]) => {
    const map: Record<string, Project[]> = {};
    list.forEach((p) => {
      if (!map[p.orgId]) map[p.orgId] = [];
      map[p.orgId].push(p);
    });
    return map;
  };

  const renderStatusBadge = (status?: string) => {
    const s = status || 'unknown';
    const label = STATUS_LABELS[s] || s;
    const color = STATUS_COLORS[s] || 'bg-gray-100 text-gray-700';
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {projects.length + pendingProjects.length} EL project(s)
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New EL Project
        </button>
      </div>

      {/* Pending Projects */}
      {pendingProjects.length > 0 && (
        <div className="border-2 border-orange-200 rounded-lg p-4 bg-orange-50">
          <h3 className="text-sm font-semibold text-orange-800 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Pending ({pendingProjects.length})
          </h3>
          <div className="space-y-3">
            {pendingProjects.map((p) => (
              <div
                key={`${p.orgId}-${p.projectId}`}
                className="bg-white rounded-lg p-4 border border-orange-100 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">
                      {p.projectName || p.projectId}
                    </span>
                    {renderStatusBadge(p.status)}
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      p.environment === 'prod' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {p.environment.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {p.fileCount} files &middot; {formatBytes(p.totalSizeBytes)} &middot; {formatDate(p.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {['creating', 'uploading', 'validating'].includes(p.status) && (
                    <button
                      onClick={() => handleDeleteProject(p.orgId, p.projectId, p.environment)}
                      disabled={actionLoading}
                      className="p-2 text-red-500 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <Link
                    href={`/el/project?orgId=${p.orgId}&projectId=${p.projectId}&env=${p.environment}`}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Production Projects */}
      {prodProjects.length > 0 && (
        <div className="border-2 border-green-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-green-800 mb-3">
            Production ({prodProjects.length})
          </h3>
          {Object.entries(projectsByOrg(prodProjects)).map(([orgId, orgProjects]) => (
            <div key={orgId} className="mb-4 last:mb-0">
              <div className="text-xs text-gray-500 mb-2">
                {organizations[orgId]?.email || orgId.substring(0, 12) + '...'}
              </div>
              <div className="space-y-2">
                {orgProjects.map((p) => (
                  <Link
                    key={p.projectId}
                    href={`/el/project?orgId=${p.orgId}&projectId=${p.projectId}&env=prod`}
                    className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-100 hover:border-blue-300 transition-colors"
                  >
                    <FolderOpen className="h-5 w-5 text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate block">
                        {p.projectName || p.projectId}
                      </span>
                      <span className="text-xs text-gray-500">{p.projectId.substring(0, 12)}...</span>
                    </div>
                    {renderStatusBadge(p.status)}
                    <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Development Projects */}
      {devProjects.length > 0 && (
        <div className="border-2 border-yellow-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-yellow-800 mb-3">
            Development ({devProjects.length})
          </h3>
          {Object.entries(projectsByOrg(devProjects)).map(([orgId, orgProjects]) => (
            <div key={orgId} className="mb-4 last:mb-0">
              <div className="text-xs text-gray-500 mb-2">
                {organizations[orgId]?.email || orgId.substring(0, 12) + '...'}
              </div>
              <div className="space-y-2">
                {orgProjects.map((p) => (
                  <Link
                    key={p.projectId}
                    href={`/el/project?orgId=${p.orgId}&projectId=${p.projectId}&env=dev`}
                    className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-100 hover:border-blue-300 transition-colors"
                  >
                    <FolderOpen className="h-5 w-5 text-blue-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate block">
                        {p.projectName || p.projectId}
                      </span>
                      <span className="text-xs text-gray-500">{p.projectId.substring(0, 12)}...</span>
                    </div>
                    {renderStatusBadge(p.status)}
                    <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {projects.length === 0 && pendingProjects.length === 0 && (
        <div className="text-center py-12">
          <FolderOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No EL projects found.</p>
          <p className="text-sm text-gray-400 mt-1">
            Create a new EL project to get started.
          </p>
        </div>
      )}

      {showCreateModal && (
        <CreateProjectModal
          organizations={organizations}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchProjects();
          }}
        />
      )}
    </div>
  );
}
