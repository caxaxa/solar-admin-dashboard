'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Upload,
  Image as ImageIcon,
  Crop,
  Brain,
  CheckSquare,
  FileText,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  Play,
  Edit3,
  Eye,
  ExternalLink,
  Thermometer,
  AlertTriangle,
  Code,
  RefreshCw,
  X,
} from 'lucide-react';
import { buildApiUrl, apiFetch } from '@/lib/api-client';

interface PipelineViewProps {
  orgId: string;
  projectId: string;
  env: string;
}

interface ProjectStatus {
  hasOrthophoto: boolean;
  hasCropAnnotation: boolean;
  hasInferenceResults: boolean;
  hasHumanReview: boolean;
  hasReport: boolean;
  isReleased?: boolean;
  reportFullUrl?: string | null;
  hasTexEdit?: boolean;
}

export function PipelineView({ orgId, projectId, env }: PipelineViewProps) {
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingRelease, setPendingRelease] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await apiFetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/status?env=${env}`)
        );
        if (!response.ok) throw new Error('Failed to fetch status');
        const data = await response.json();
        setStatus(data);
      } catch (err) {
        console.error('Failed to fetch project status:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
  }, [orgId, projectId, env]);

  const stages = [
    {
      id: 'upload',
      label: 'Upload',
      icon: Upload,
      description: 'Drone images uploaded',
      complete: true, // Always true if project exists
    },
    {
      id: 'odm',
      label: 'ODM Processing',
      icon: ImageIcon,
      description: 'Orthophoto generated',
      complete: status?.hasOrthophoto || false,
      actionLabel: status?.hasOrthophoto ? undefined : 'Start ODM',
      actionType: status?.hasOrthophoto ? undefined : 'start-odm',
      secondaryActionLabel: status?.hasOrthophoto ? 'Reprocess ODM' : undefined,
      secondaryActionType: status?.hasOrthophoto ? 'start-odm' : undefined,
    },
    {
      id: 'crop',
      label: 'Human Crop & Rotate',
      icon: Crop,
      description: 'Define region of interest',
      complete: status?.hasCropAnnotation || false,
      actionLabel: 'Edit Crop',
      actionHref: `/thermographic/annotate/crop?orgId=${orgId}&projectId=${projectId}&env=${env}`,
    },
    {
      id: 'inference',
      label: 'AI Inference',
      icon: Brain,
      description: 'Detectron2 panel detection',
      complete: status?.hasInferenceResults || false,
      actionLabel: 'Run Inference',
      actionType: 'run-inference',
    },
    {
      id: 'review',
      label: 'Human Review',
      icon: CheckSquare,
      description: 'Verify and correct detections',
      complete: status?.hasHumanReview || false,
      actionLabel: 'Review Detections',
      actionHref: `/thermographic/annotate/defects?orgId=${orgId}&projectId=${projectId}&env=${env}`,
    },
    {
      id: 'report',
      label: 'Generate Report',
      icon: FileText,
      description: 'Create PDF report',
      complete: status?.hasReport || false,
      actionLabel: 'Generate',
      actionType: 'generate-report',
    },
    {
      id: 'review-report',
      label: 'Review Report',
      icon: Eye,
      description: 'Verify generated PDF before release',
      complete: status?.hasReport || false, // Same as generate - complete when report exists
      actionLabel: 'View PDF',
      externalUrl: status?.reportFullUrl || undefined,
      thermalReviewHref: status?.hasReport
        ? `/thermographic/annotate/thermal?orgId=${orgId}&projectId=${projectId}&env=${env}`
        : undefined,
      // TeX editing features
      texEditHref: status?.hasReport
        ? `/thermographic/annotate/tex?orgId=${orgId}&projectId=${projectId}&env=${env}`
        : undefined,
      recompileTexAction: status?.hasTexEdit ? 'recompile-tex' : undefined,
    },
    {
      id: 'release',
      label: 'Release to Client',
      icon: Send,
      description: 'Make available to end user & archive training data',
      complete: status?.isReleased || false,
      actionLabel: status?.isReleased ? 'Released' : 'Release with Paywall',
      actionType: status?.isReleased ? undefined : 'release',
      secondaryActionLabel: status?.isReleased ? undefined : 'Release for Free',
      secondaryActionType: status?.isReleased ? undefined : 'release-free',
      // Additional error release action
      errorActionLabel: 'Release with Error',
      errorActionType: status?.isReleased ? undefined : 'release-error',
    },
  ];

  const releaseActions = ['release', 'release-free', 'release-error'];

  const handleAction = async (actionType: string) => {
    // Intercept release actions to show confirmation dialog
    if (releaseActions.includes(actionType) && !pendingRelease) {
      setPendingRelease(actionType);
      return;
    }

    setActionLoading(actionType);
    try {
      // Handle run-inference action with dedicated endpoint
      if (actionType === 'run-inference') {
        const response = await apiFetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/run-inference?env=${env}`),
          { method: 'POST' }
        );
        if (!response.ok) throw new Error('Failed to submit inference job');
        const data = await response.json();
        console.log('Inference job submitted:', data.jobId);
        alert(`Inference job submitted successfully!\nJob ID: ${data.jobId}`);
      } else if (actionType === 'start-odm') {
        // Handle ODM processing with dedicated endpoint
        const response = await apiFetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/start-odm?env=${env}`),
          { method: 'POST' }
        );
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || errorData.message || 'Failed to start ODM processing');
        }
        const data = await response.json();
        console.log('ODM processing started:', data);

        if (data.status === 'already_processing') {
          alert(`Project already processing!\n\nExecution: ${data.executionArn?.split(':').pop() || 'unknown'}`);
        } else {
          alert(`ODM processing started successfully!\n\nFiles: ${data.fileCount}\nSize: ${data.totalSizeMb} MB\nInstance: ${data.instanceType}`);
        }
      } else {
        // Generic action handler for other action types
        const releaseFree = actionType === 'release-free';
        const resolvedActionType = releaseFree ? 'release' : actionType;
        const releaseModeQuery = releaseFree ? '&release_mode=free' : '';
        const response = await apiFetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/actions/${resolvedActionType}?env=${env}${releaseModeQuery}`),
          { method: 'POST' }
        );
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || errorData.message || 'Action failed');
        }
        const data = await response.json();

        // Show success message with job ID if available
        if (data.jobId) {
          console.log(`${actionType} job submitted:`, data.jobId);
          alert(`Job submitted successfully!\nAction: ${actionType}\nJob ID: ${data.jobId}`);
        } else if (data.success) {
          // Special handling for release action
          if ((actionType === 'release' || actionType === 'release-free') && data.training_data_archived) {
            alert(`Project released successfully!\n\nTraining data archived:\n${data.archived_files?.length || 0} files copied to training bucket.`);
          } else {
            alert(data.message || `${actionType} completed successfully!`);
          }
        }
      }

      // Refresh status
      const statusResponse = await apiFetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/status?env=${env}`)
      );
      if (statusResponse.ok) {
        setStatus(await statusResponse.json());
      }
    } catch (err) {
      console.error('Action failed:', err);
      alert(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const confirmRelease = () => {
    if (!pendingRelease) return;
    const action = pendingRelease;
    setPendingRelease(null);
    // Call handleAction — pendingRelease is now null so it won't re-intercept
    handleAction(action);
  };

  const releaseConfig: Record<string, { title: string; description: string; confirmLabel: string; color: string }> = {
    'release': {
      title: 'Release with Paywall',
      description: 'The client will need to pay to access the report. Training data (orthophoto + defect labels) will be archived for model retraining.',
      confirmLabel: 'Confirm Release',
      color: 'bg-blue-600 hover:bg-blue-700',
    },
    'release-free': {
      title: 'Release for Free',
      description: 'The client will have free access to the report (paywall bypassed). Training data (orthophoto + defect labels) will be archived for model retraining.',
      confirmLabel: 'Confirm Free Release',
      color: 'bg-blue-600 hover:bg-blue-700',
    },
    'release-error': {
      title: 'Release with Error',
      description: 'The client will be notified that processing failed for this project. No training data will be archived.',
      confirmLabel: 'Confirm Error Release',
      color: 'bg-red-600 hover:bg-red-700',
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading project status...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-4">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const isActionLoading = actionLoading === stage.actionType;

          return (
            <div
              key={stage.id}
              className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-100 dark:border-gray-800 p-5"
            >
              <div className="flex-shrink-0">
                {stage.complete ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                ) : (
                  <Circle className="h-6 w-6 text-gray-300" />
                )}
              </div>

              <div className="flex-shrink-0">
                <Icon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {index + 1}. {stage.label}
                  </span>
                  {stage.complete && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                      Complete
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{stage.description}</p>
              </div>

              <div className="flex-shrink-0 flex gap-2">
                {stage.actionHref && (
                  <Link
                    href={stage.actionHref}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Edit3 className="h-4 w-4" />
                    {stage.actionLabel}
                  </Link>
                )}
                {stage.externalUrl && (
                  <a
                    href={stage.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {stage.actionLabel}
                  </a>
                )}
                {stage.thermalReviewHref && (
                  <Link
                    href={stage.thermalReviewHref}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Thermometer className="h-4 w-4" />
                    Thermal Review
                  </Link>
                )}
                {stage.texEditHref && (
                  <Link
                    href={stage.texEditHref}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-gray-600 text-white hover:bg-gray-700"
                    title="Edit the LaTeX source for this report"
                  >
                    <Code className="h-4 w-4" />
                    Edit TeX
                  </Link>
                )}
                {stage.recompileTexAction && (
                  <button
                    onClick={() => handleAction(stage.recompileTexAction!)}
                    disabled={actionLoading === stage.recompileTexAction}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    title="Recompile PDF from edited TeX (without regenerating data)"
                  >
                    {actionLoading === stage.recompileTexAction ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Recompile TeX
                  </button>
                )}
                {stage.actionType && (
                  <button
                    onClick={() => handleAction(stage.actionType!)}
                    disabled={isActionLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
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
                      <RefreshCw className="h-4 w-4" />
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
              </div>
            </div>
          );
        })}
      </div>

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
