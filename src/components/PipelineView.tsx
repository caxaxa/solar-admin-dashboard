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
} from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

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

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch(
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
      actionLabel: status?.hasOrthophoto ? undefined : 'Gerar Relatório',
      actionType: status?.hasOrthophoto ? undefined : 'start-odm',
    },
    {
      id: 'crop',
      label: 'Human Crop & Rotate',
      icon: Crop,
      description: 'Define region of interest',
      complete: status?.hasCropAnnotation || false,
      actionLabel: 'Edit Crop',
      actionHref: `/annotate/crop?orgId=${orgId}&projectId=${projectId}&env=${env}`,
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
      actionHref: `/annotate/defects?orgId=${orgId}&projectId=${projectId}&env=${env}`,
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
        ? `/annotate/thermal?orgId=${orgId}&projectId=${projectId}&env=${env}`
        : undefined,
      // TeX editing features
      texEditHref: status?.hasReport
        ? `/annotate/tex?orgId=${orgId}&projectId=${projectId}&env=${env}`
        : undefined,
      recompileTexAction: status?.hasTexEdit ? 'recompile-tex' : undefined,
    },
    {
      id: 'release',
      label: 'Release to Client',
      icon: Send,
      description: 'Make available to end user & archive training data',
      complete: status?.isReleased || false,
      actionLabel: status?.isReleased ? 'Released' : 'Release',
      actionType: status?.isReleased ? undefined : 'release',
      // Additional error release action
      errorActionLabel: 'Release with Error',
      errorActionType: status?.isReleased ? undefined : 'release-error',
    },
  ];

  const handleAction = async (actionType: string) => {
    setActionLoading(actionType);
    try {
      // Handle run-inference action with dedicated endpoint
      if (actionType === 'run-inference') {
        const response = await fetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/run-inference?env=${env}`),
          { method: 'POST' }
        );
        if (!response.ok) throw new Error('Failed to submit inference job');
        const data = await response.json();
        console.log('Inference job submitted:', data.jobId);
        alert(`Inference job submitted successfully!\nJob ID: ${data.jobId}`);
      } else if (actionType === 'start-odm') {
        // Handle ODM processing with dedicated endpoint
        const response = await fetch(
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
        const response = await fetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/actions/${actionType}?env=${env}`),
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
          if (actionType === 'release' && data.training_data_archived) {
            alert(`Project released successfully!\n\nTraining data archived:\n${data.archived_files?.length || 0} files copied to training bucket.`);
          } else {
            alert(data.message || `${actionType} completed successfully!`);
          }
        }
      }

      // Refresh status
      const statusResponse = await fetch(
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading project status...</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-6">
        Processing Pipeline
      </h3>

      <div className="space-y-4">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const isActionLoading = actionLoading === stage.actionType;

          return (
            <div
              key={stage.id}
              className={`flex items-center gap-4 p-4 rounded-lg border ${
                stage.complete
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex-shrink-0">
                {stage.complete ? (
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                ) : (
                  <Circle className="h-8 w-8 text-gray-400" />
                )}
              </div>

              <div className="flex-shrink-0">
                <Icon
                  className={`h-6 w-6 ${
                    stage.complete ? 'text-green-600' : 'text-gray-500'
                  }`}
                />
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
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
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {stage.actionLabel}
                  </a>
                )}
                {stage.thermalReviewHref && (
                  <Link
                    href={stage.thermalReviewHref}
                    className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                  >
                    <Thermometer className="h-4 w-4" />
                    Thermal Review
                  </Link>
                )}
                {stage.texEditHref && (
                  <Link
                    href={stage.texEditHref}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
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
                    className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50"
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
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {stage.actionLabel}
                  </button>
                )}
                {stage.errorActionType && (
                  <button
                    onClick={() => handleAction(stage.errorActionType!)}
                    disabled={actionLoading === stage.errorActionType}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
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
    </div>
  );
}
