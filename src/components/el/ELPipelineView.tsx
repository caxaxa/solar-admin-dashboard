'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload,
  Brain,
  CheckSquare,
  FileText,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  Eye,
  ExternalLink,
} from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

interface ELPipelineViewProps {
  orgId: string;
  projectId: string;
  env: string;
}

interface ELProjectStatus {
  hasImages: boolean;
  hasDetections: boolean;
  hasHumanReview: boolean;
  hasReport: boolean;
  isReleased: boolean;
  reportFullUrl?: string;
  totalImages?: number;
  reviewedImages?: number;
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
}

export function ELPipelineView({ orgId, projectId, env }: ELPipelineViewProps) {
  const [status, setStatus] = useState<ELProjectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(
        buildApiUrl(`/el/projects/${orgId}/${projectId}/status?env=${env}`)
      );
      if (!resp.ok) throw new Error('Failed to fetch EL project status');
      const data = await resp.json();
      setStatus(data);
    } catch {
      setStatus({
        hasImages: false,
        hasDetections: false,
        hasHumanReview: false,
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

  const handleAction = async (actionType: string) => {
    setActionLoading(true);
    try {
      let url: string;
      if (actionType === 'run-detections') {
        url = buildApiUrl(`/el/projects/${orgId}/${projectId}/run-detections?env=${env}`);
      } else if (actionType === 'release-free') {
        url = buildApiUrl(`/el/projects/${orgId}/${projectId}/actions/release?env=${env}&release_mode=free`);
      } else {
        url = buildApiUrl(`/el/projects/${orgId}/${projectId}/actions/${actionType}?env=${env}`);
      }

      const resp = await fetch(url, { method: 'POST' });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Action '${actionType}' failed`);
      }

      const data = await resp.json().catch(() => ({}));
      if (data.jobId) {
        alert(`Job submitted: ${data.jobId}`);
      }

      await fetchStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        <span className="ml-2 text-gray-600">Loading project status...</span>
      </div>
    );
  }

  const s = status!;

  const stages: Stage[] = [
    {
      id: 'upload',
      label: '1. Upload EL Images',
      icon: Upload,
      isComplete: s.hasImages,
    },
    {
      id: 'detect',
      label: '2. Run Detections',
      icon: Brain,
      isComplete: s.hasDetections,
      actionLabel: 'Run Detections',
      actionType: 'run-detections',
    },
    {
      id: 'review',
      label: '3. Human Review',
      icon: CheckSquare,
      isComplete: s.hasHumanReview,
      actionLabel: 'Review Detections',
      actionHref: `/el/annotate/defects?orgId=${orgId}&projectId=${projectId}&env=${env}`,
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
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-purple-600 text-white hover:bg-purple-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View PDF
                  </a>
                )}

                {/* Navigation action (review) */}
                {stage.actionHref && (
                  <Link
                    href={stage.actionHref}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-orange-600 text-white hover:bg-orange-700"
                  >
                    <Eye className="h-4 w-4" />
                    {stage.actionLabel}
                  </Link>
                )}

                {/* Secondary action (e.g. mark review complete) */}
                {stage.secondaryActionType && !stage.isComplete && (
                  <button
                    onClick={() => handleAction(stage.secondaryActionType!)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {stage.secondaryActionLabel}
                  </button>
                )}

                {/* API action (detect, generate-report) */}
                {stage.actionType && (
                  <button
                    onClick={() => handleAction(stage.actionType!)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {stage.actionLabel}
                  </button>
                )}

                {/* Release actions */}
                {stage.id === 'release' && !s.isReleased && (
                  <>
                    <button
                      onClick={() => handleAction('release')}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actionLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Release with Paywall
                    </button>
                    <button
                      onClick={() => handleAction('release-free')}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Release Free
                    </button>
                    <button
                      onClick={() => handleAction('release-error')}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Release Error
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
