'use client';

import { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2, CheckCircle, AlertCircle, File } from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

interface ProjectUploadModalProps {
  orgId: string;
  projectId: string;
  projectName: string;
  environment: 'dev' | 'prod';
  onClose: () => void;
  onSuccess: () => void;
}

interface FileUpload {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
}

const MAX_CONCURRENT_UPLOADS = 5;

export function ProjectUploadModal({
  orgId,
  projectId,
  projectName,
  environment,
  onClose,
  onSuccess,
}: ProjectUploadModalProps) {
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const newFiles: FileUpload[] = selectedFiles.map((file) => ({
      file,
      id: `${file.name}-${file.lastModified}-${file.size}`,
      status: 'pending',
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    const imageFiles = droppedFiles.filter((f) =>
      f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.tif') || f.name.toLowerCase().endsWith('.tiff')
    );
    const newFiles: FileUpload[] = imageFiles.map((file) => ({
      file,
      id: `${file.name}-${file.lastModified}-${file.size}`,
      status: 'pending',
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const uploadFile = async (fileUpload: FileUpload): Promise<boolean> => {
    console.log(`[Upload] Starting upload for: ${fileUpload.file.name}`);
    // Update status to uploading
    setFiles((prev) =>
      prev.map((f) => (f.id === fileUpload.id ? { ...f, status: 'uploading' } : f))
    );

    try {
      // Get presigned URL
      const presignResponse = await fetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/presign-upload?env=${environment}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: fileUpload.file.name,
            content_type: fileUpload.file.type || 'application/octet-stream',
            file_size: fileUpload.file.size,
          }),
        }
      );

      if (!presignResponse.ok) {
        throw new Error('Failed to get upload URL');
      }

      const { upload_url, file_id } = await presignResponse.json();

      // Upload to S3
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', fileUpload.file.type || 'application/octet-stream');

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setFiles((prev) =>
              prev.map((f) => (f.id === fileUpload.id ? { ...f, progress } : f))
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(fileUpload.file);
      });

      // Mark file as complete in backend
      const completeResponse = await fetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/files/${file_id}/complete?env=${environment}`),
        { method: 'POST' }
      );

      if (!completeResponse.ok) {
        throw new Error('Failed to complete upload');
      }

      console.log(`[Upload] SUCCESS for: ${fileUpload.file.name}`);
      setFiles((prev) =>
        prev.map((f) => (f.id === fileUpload.id ? { ...f, status: 'success', progress: 100 } : f))
      );
      return true;
    } catch (err) {
      console.error(`[Upload] FAILED for: ${fileUpload.file.name}`, err);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileUpload.id
            ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
            : f
        )
      );
      return false;
    }
  };

  const handleUpload = async () => {
    setError(null);
    setUploading(true);

    const pendingFiles = files.filter((f) => f.status === 'pending');
    let uploadSuccessCount = 0;

    // Upload files with concurrency limit
    const uploadQueue = [...pendingFiles];
    const inProgress = new Set<Promise<void>>();

    const uploadFileWithTracking = async (fileUpload: FileUpload) => {
      const success = await uploadFile(fileUpload);
      console.log(`[Upload] Tracking result for ${fileUpload.file.name}: success=${success}, count will be ${uploadSuccessCount + (success ? 1 : 0)}`);
      if (success) {
        uploadSuccessCount++;
      }
    };

    while (uploadQueue.length > 0 || inProgress.size > 0) {
      while (inProgress.size < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
        const fileUpload = uploadQueue.shift()!;
        const uploadPromise = uploadFileWithTracking(fileUpload).finally(() => {
          inProgress.delete(uploadPromise);
        });
        inProgress.add(uploadPromise);
      }

      if (inProgress.size > 0) {
        await Promise.race(inProgress);
      }
    }

    // Wait a tick for state to settle
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check if any uploads succeeded
    console.log(`[Upload] Final success count: ${uploadSuccessCount}`);
    if (uploadSuccessCount === 0) {
      setError('No files were uploaded successfully');
      setUploading(false);
      return;
    }

    // Finalize the upload
    setFinalizing(true);
    try {
      const finalizeResponse = await fetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/finalize-upload?env=${environment}`),
        { method: 'POST' }
      );

      if (!finalizeResponse.ok) {
        throw new Error('Failed to finalize upload');
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize upload');
    } finally {
      setFinalizing(false);
      setUploading(false);
    }
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const uploadingCount = files.filter((f) => f.status === 'uploading').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upload Images</h2>
            <p className="text-sm text-gray-500">
              Project: {projectName}{' '}
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                environment === 'prod' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {environment.toUpperCase()}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-auto">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">
              Drag and drop images here, or click to browse
            </p>
            <p className="text-sm text-gray-400">
              Supports JPG, PNG, TIFF formats
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.tif,.tiff"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Files ({files.length})
                </span>
                {(successCount > 0 || errorCount > 0) && (
                  <span className="text-sm text-gray-500">
                    {successCount} uploaded, {errorCount} failed
                  </span>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                {files.map((fileUpload) => (
                  <div key={fileUpload.id} className="flex items-center gap-3 p-3">
                    <File className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {fileUpload.file.name}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {formatSize(fileUpload.file.size)}
                        </span>
                        {fileUpload.status === 'uploading' && (
                          <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                            <div
                              className="bg-blue-600 h-1.5 rounded-full transition-all"
                              style={{ width: `${fileUpload.progress}%` }}
                            />
                          </div>
                        )}
                        {fileUpload.error && (
                          <span className="text-xs text-red-600">{fileUpload.error}</span>
                        )}
                      </div>
                    </div>
                    {fileUpload.status === 'pending' && (
                      <button
                        onClick={() => removeFile(fileUpload.id)}
                        className="text-gray-400 hover:text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {fileUpload.status === 'uploading' && (
                      <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                    )}
                    {fileUpload.status === 'success' && (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                    {fileUpload.status === 'error' && (
                      <AlertCircle className="h-4 w-4 text-red-600" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            disabled={uploading || pendingCount === 0}
          >
            {uploading ? (
              finalizing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Finalizing...
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading ({uploadingCount}/{pendingCount + uploadingCount + successCount})
                </>
              )
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload {pendingCount} file{pendingCount !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
