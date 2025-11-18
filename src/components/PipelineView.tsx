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
} from 'lucide-react';

interface PipelineViewProps {
  orgId: string;
  projectId: string;
  env: string;
}

interface ProjectStatus {
  hasOrthophoto: boolean;
  hasCropAnnotation: boolean;
  hasPreAnnotations: boolean;
  hasDefectLabels: boolean;
  hasReport: boolean;
}

export function PipelineView({ orgId, projectId, env }: PipelineViewProps) {
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await fetch(
          `/api/projects/${orgId}/${projectId}/status?env=${env}`
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
    },
    {
      id: 'crop',
      label: 'Human Crop & Rotate',
      icon: Crop,
      description: 'Define region of interest',
      complete: status?.hasCropAnnotation || false,
      actionLabel: 'Edit Crop',
      actionHref: `/projects/${orgId}/${projectId}/annotate/crop?env=${env}`,
    },
    {
      id: 'inference',
      label: 'AI Inference',
      icon: Brain,
      description: 'Detectron2 panel detection',
      complete: status?.hasPreAnnotations || false,
      actionLabel: 'Run Inference',
      actionType: 'run-inference',
    },
    {
      id: 'review',
      label: 'Human Review',
      icon: CheckSquare,
      description: 'Verify and correct detections',
      complete: status?.hasDefectLabels || false,
      actionLabel: 'Review Detections',
      actionHref: `/projects/${orgId}/${projectId}/annotate/defects?env=${env}`,
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
      id: 'release',
      label: 'Release to Client',
      icon: Send,
      description: 'Make available to end user',
      complete: false,
      actionLabel: 'Release',
      actionType: 'release',
    },
  ];

  const handleAction = async (actionType: string) => {
    setActionLoading(actionType);
    try {
      // Handle run-inference action with the new endpoint
      if (actionType === 'run-inference') {
        const response = await fetch(
          `/api/projects/${orgId}/${projectId}/run-inference?env=${env}`,
          { method: 'POST' }
        );
        if (!response.ok) throw new Error('Failed to submit inference job');
        const data = await response.json();
        console.log('Inference job submitted:', data.jobId);
        alert(`Inference job submitted successfully!\nJob ID: ${data.jobId}`);
      } else {
        // Generic action handler for other action types
        const response = await fetch(
          `/api/projects/${orgId}/${projectId}/actions/${actionType}?env=${env}`,
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
          alert(`${actionType} completed successfully!`);
        }
      }

      // Refresh status
      const statusResponse = await fetch(
        `/api/projects/${orgId}/${projectId}/status?env=${env}`
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

              <div className="flex-shrink-0">
                {stage.actionHref && (
                  <Link
                    href={stage.actionHref}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Edit3 className="h-4 w-4" />
                    {stage.actionLabel}
                  </Link>
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
