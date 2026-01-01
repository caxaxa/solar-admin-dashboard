'use client';

import { useState } from 'react';
import { X, Loader2, Plus, Upload, CheckCircle } from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';
import { ProjectUploadModal } from './ProjectUploadModal';

interface OrgInfo {
  email: string;
}

interface CreateProjectModalProps {
  organizations: Record<string, OrgInfo>;
  onClose: () => void;
  onSuccess: () => void;
}

interface CreatedProject {
  projectId: string;
  projectName: string;
  userId: string;
  environment: 'dev' | 'prod';
}

export function CreateProjectModal({ organizations, onClose, onSuccess }: CreateProjectModalProps) {
  const [userId, setUserId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<'dev' | 'prod'>('prod');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<CreatedProject | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const orgEntries = Object.entries(organizations).filter(([id]) => id.includes('-'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!userId) {
      setError('Please select a user');
      return;
    }
    if (!projectName.trim()) {
      setError('Project name is required');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(buildApiUrl('/projects/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          projectName: projectName.trim(),
          description: description.trim(),
          environment,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create project');
      }

      const result = await response.json();
      console.log('Project created:', result);

      // Store created project info and show success state
      setCreatedProject({
        projectId: result.projectId,
        projectName: result.projectName,
        userId: result.userId,
        environment: result.environment,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = () => {
    setShowUploadModal(false);
    onSuccess();
    onClose();
  };

  const handleSkipUpload = () => {
    onSuccess();
    onClose();
  };

  // Show upload modal if user clicked upload
  if (showUploadModal && createdProject) {
    return (
      <ProjectUploadModal
        orgId={createdProject.userId}
        projectId={createdProject.projectId}
        projectName={createdProject.projectName}
        environment={createdProject.environment}
        onClose={() => setShowUploadModal(false)}
        onSuccess={handleUploadComplete}
      />
    );
  }

  // Show success state after project creation
  if (createdProject) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Project Created</h2>
            <button onClick={handleSkipUpload} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {createdProject.projectName}
            </h3>
            <p className="text-sm text-gray-500 mb-2">
              Project ID: <span className="font-mono">{createdProject.projectId}</span>
            </p>
            <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${
              createdProject.environment === 'prod'
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}>
              {createdProject.environment.toUpperCase()}
            </span>

            <p className="mt-6 text-gray-600">
              Would you like to upload images now?
            </p>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={handleSkipUpload}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Skip for Now
              </button>
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload Images
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Create Project for User</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="userId" className="block text-sm font-medium text-gray-700 mb-1">
              User *
            </label>
            <select
              id="userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Select a user...</option>
              {orgEntries.map(([id, info]) => (
                <option key={id} value={id}>
                  {info.email} ({id.substring(0, 8)}...)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-1">
              Project Name *
            </label>
            <input
              id="projectName"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., Solar Farm Area 42"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Environment *
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="prod"
                  checked={environment === 'prod'}
                  onChange={() => setEnvironment('prod')}
                  className="mr-2"
                />
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold">
                  PRODUCTION
                </span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="dev"
                  checked={environment === 'dev'}
                  onChange={() => setEnvironment('dev')}
                  className="mr-2"
                />
                <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-bold">
                  DEVELOPMENT
                </span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Project
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
