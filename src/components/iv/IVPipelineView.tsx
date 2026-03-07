'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload,
  RefreshCw,
  CheckSquare,
  FileText,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  Eye,
  ExternalLink,
  AlertTriangle,
  X,
} from 'lucide-react';
import { buildApiUrl, apiFetch } from '@/lib/api-client';

interface IVPipelineViewProps {
  orgId: string;
  projectId: string;
  env: string;
}

interface IVProjectStatus {
  hasData: boolean;
  hasSTCTranslation: boolean;
  hasReview: boolean;
  hasReport: boolean;
  isReleased: boolean;
  reportFullUrl?: string;
}

interface Stage {
  id: string;
  label: string;
  icon: typeof Upload;
  isComplete: boolean;
  actionLabel?: string;
  actionType?: string;
  actionHref?: string;
  externalUrl?: string;
  secondaryActionLabel?: string;
  secondaryActionType?: string;
  errorActionLabel?: string;
  errorActionType?: string;
}

export function IVPipelineView({ orgId, projectId, env }: IVPipelineViewProps) {
  const [status, setStatus] = useState<IVProjectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingRelease, setPendingRelease] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await apiFetch(
        buildApiUrl(`/iv/projects/${orgId}/${projectId}/status?env=${env}`)
      );
      if (!resp.ok) throw new Error('Failed to fetch IV project status');
      const data = await resp.json();
      setStatus(data);
    } catch {
      setStatus({
        hasData: false,
        hasSTCTranslation: false,
        hasReview: false,
        hasReport: false,
        isReleased: false,
      });
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId, env]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const releaseActions = ['release', 'release-free', 'release-error'];

  const handleAction = async (actionType: string) => {
    // Intercept release actions to show confirmation dialog
    if (releaseActions.includes(actionType) && !pendingRelease) {
      setPendingRelease(actionType);
      return;
    }

    setActionLoading(actionType);
    try {
      let url: string;
      if (actionType === 'release-free') {
        url = buildApiUrl(`/iv/projects/${orgId}/${projectId}/actions/release?env=${env}&release_mode=free`);
      } else {
        url = buildApiUrl(`/iv/projects/${orgId}/${projectId}/actions/${actionType}?env=${env}`);
      }

      const resp = await apiFetch(url, { method: 'POST' });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || data.message || `Action '${actionType}' failed`);
      }

      const data = await resp.json().catch(() => ({}));

      if (data.jobId) {
        alert(`Job submitted: ${data.jobId}`);
      } else if (data.success) {
        if ((actionType === 'release' || actionType === 'release-free') && data.training_data_archived) {
          alert(`Project released successfully!\n\nTraining data archived:\n${data.archived_files?.length || 0} files copied to training bucket.`);
        } else {
          alert(data.message || `${actionType} completed successfully!`);
        }
      }

      await fetchStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const confirmRelease = () => {
    if (!pendingRelease) return;
    const action = pendingRelease;
    setPendingRelease(null);
    handleAction(action);
  };

  const releaseConfig: Record<string, { title: string; description: string; confirmLabel: string; color: string }> = {
    'release': {
      title: 'Release with Paywall',
      description: 'The client will need to pay to access the IV Curve report. Data will be archived.',
      confirmLabel: 'Confirm Release',
      color: 'bg-blue-600 hover:bg-blue-700',
    },
    'release-free': {
      title: 'Release for Free',
      description: 'The client will have free access to the IV Curve report (paywall bypassed). Data will be archived.',
      confirmLabel: 'Confirm Free Release',
      color: 'bg-blue-600 hover:bg-blue-700',
    },
    'release-error': {
      title: 'Release with Error',
      description: 'The client will be notified that IV Curve processing failed for this project. No data will be archived.',
      confirmLabel: 'Confirm Error Release',
      color: 'bg-red-600 hover:bg-red-700',
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading project status...</span>
      </div>
    );
  }

  const s = status!;

  const stages: Stage[] = [
    {
      id: 'upload',
      label: '1. Upload IV Data',
      icon: Upload,
      isComplete: s.hasData,
    },
    {
      id: 'stc-translation',
      label: '2. STC Translation',
      icon: RefreshCw,
      isComplete: s.hasSTCTranslation,
      actionLabel: 'Run STC Translation',
      actionType: 'run-stc-translation',
    },
    {
      id: 'review',
      label: '3. Admin Review',
      icon: CheckSquare,
      isComplete: s.hasReview,
      actionLabel: 'Review Data',
      actionHref: `/iv/review?orgId=${orgId}&projectId=${projectId}&env=${env}`,
      secondaryActionLabel: 'Mark Review Complete',
      secondaryActionType: 'complete-review',
    },
    {
      id: 'report',
      label: '4. Generate Report',
      icon: FileText,
      isComplete: s.hasReport,
      actionLabel: 'Generate Report',
      actionType: 'generate-report',
      externalUrl: s.reportFullUrl,
    },
    {
      id: 'release',
      label: '5. Release to Client',
      icon: Send,
      isComplete: s.isReleased,
      actionLabel: s.isReleased ? 'Released' : 'Release with Paywall',
      actionType: s.isReleased ? undefined : 'release',
      secondaryActionLabel: s.isReleased ? undefined : 'Release for Free',
      secondaryActionType: s.isReleased ? undefined : 'release-free',
      errorActionLabel: 'Release with Error',
      errorActionType: s.isReleased ? undefined : 'release-error',
    },
  ];

  return (
    <div className="space-y-4">
      {stages.map((stage) => {
        const Icon = stage.icon;
        return (
          <div
            key={stage.id}
            className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-100 dark:border-gray-800 p-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {stage.isComplete ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                ) : (
                  <Circle className="h-6 w-6 text-gray-300" />
                )}
                <Icon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {stage.label}
                </span>
                {stage.isComplete && (
                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                    Complete
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* View PDF link for report stage */}
                {stage.externalUrl && (
                  <a
                    href={stage.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View PDF
                  </a>
                )}

                {/* Navigation action (review) */}
                {stage.actionHref && (
                  <Link
                    href={stage.actionHref}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Eye className="h-4 w-4" />
                    {stage.actionLabel}
                  </Link>
                )}

                {/* Secondary action (e.g. mark review complete) — only for non-release stages */}
                {stage.secondaryActionType && !stage.isComplete && stage.id !== 'release' && (
                  <button
                    onClick={() => handleAction(stage.secondaryActionType!)}
                    disabled={actionLoading === stage.secondaryActionType}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading === stage.secondaryActionType ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {stage.secondaryActionLabel}
                  </button>
                )}

                {/* API action (stc-translation, generate-report) — only for non-release stages */}
                {stage.actionType && !stage.actionHref && stage.id !== 'release' && (
                  <button
                    onClick={() => handleAction(stage.actionType!)}
                    disabled={actionLoading === stage.actionType}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {actionLoading === stage.actionType ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {stage.actionLabel}
                  </button>
                )}

                {/* Release stage actions */}
                {stage.id === 'release' && !s.isReleased && (
                  <>
                    {stage.actionType && (
                      <button
                        onClick={() => handleAction(stage.actionType!)}
                        disabled={actionLoading === stage.actionType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {actionLoading === stage.actionType ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        {stage.actionLabel}
                      </button>
                    )}
                    {stage.secondaryActionType && (
                      <button
                        onClick={() => handleAction(stage.secondaryActionType!)}
                        disabled={actionLoading === stage.secondaryActionType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        {actionLoading === stage.secondaryActionType ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        {stage.secondaryActionLabel}
                      </button>
                    )}
                    {stage.errorActionType && (
                      <button
                        onClick={() => handleAction(stage.errorActionType!)}
                        disabled={actionLoading === stage.errorActionType}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        title="Release project with error notification to client"
                      >
                        {actionLoading === stage.errorActionType ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <AlertTriangle className="h-4 w-4" />
                        )}
                        {stage.errorActionLabel}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Release Confirmation Modal */}
      {pendingRelease && releaseConfig[pendingRelease] && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                {releaseConfig[pendingRelease].title}
              </h2>
              <button
                onClick={() => setPendingRelease(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <Send className="h-8 w-8 text-gray-400" />
                <p className="text-gray-700">
                  {releaseConfig[pendingRelease].description}
                </p>
              </div>

              <p className="text-sm text-gray-500 mb-6">
                This action cannot be undone. Are you sure you want to proceed?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setPendingRelease(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRelease}
                  className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors ${releaseConfig[pendingRelease].color}`}
                >
                  {releaseConfig[pendingRelease].confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
