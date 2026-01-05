'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { buildApiUrl } from '@/lib/api-client';
import { Save, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

export default function TexEditorPage() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get('orgId');
  const projectId = searchParams.get('projectId');
  const env = searchParams.get('env') || 'dev';

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [lastModified, setLastModified] = useState<string | null>(null);

  // Track if content has been modified
  const hasChanges = content !== originalContent;

  // Fetch TeX content on mount
  useEffect(() => {
    if (!orgId || !projectId) return;

    async function fetchContent() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(
          buildApiUrl(`/projects/${orgId}/${projectId}/tex-content?env=${env}`)
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to load TeX content');
        }

        const data = await response.json();
        setContent(data.content);
        setOriginalContent(data.content);
        setLastModified(data.lastModified);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load TeX content');
      } finally {
        setLoading(false);
      }
    }

    fetchContent();
  }, [orgId, projectId, env]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!hasChanges) return;

    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);

      const response = await fetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/tex-content?env=${env}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save TeX content');
      }

      setOriginalContent(content);
      setSaveSuccess(true);
      setLastModified(new Date().toISOString());

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [content, hasChanges, orgId, projectId, env]);

  // Keyboard shortcut for save (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (!orgId || !projectId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white shadow rounded-lg p-10 text-center space-y-4">
          <p className="text-gray-700">Missing project context.</p>
          <Link href="/projects" className="text-blue-600 hover:underline">
            Back to project list
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Link
              href={`/project?orgId=${orgId}&projectId=${projectId}&env=${env}`}
              className="text-gray-400 hover:text-gray-200 text-sm"
            >
              &larr; Back to Project
            </Link>
            <span className="text-gray-600">|</span>
            <h2 className="text-lg font-semibold text-white">TeX Editor</h2>
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold ${
                env === 'prod'
                  ? 'bg-green-600 text-white'
                  : 'bg-yellow-600 text-white'
              }`}
            >
              {env.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {lastModified && (
              <span className="text-gray-400 text-xs">
                Last modified: {new Date(lastModified).toLocaleString()}
              </span>
            )}

            {hasChanges && (
              <span className="text-yellow-400 text-xs">Unsaved changes</span>
            )}

            {saveSuccess && (
              <span className="flex items-center gap-1 text-green-400 text-xs">
                <CheckCircle className="h-4 w-4" />
                Saved! Click &quot;Recompile TeX&quot; on the pipeline to regenerate PDF.
              </span>
            )}

            {error && (
              <span className="flex items-center gap-1 text-red-400 text-xs">
                <AlertCircle className="h-4 w-4" />
                {error}
              </span>
            )}

            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white transition-colors ${
                hasChanges
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-600 cursor-not-allowed'
              } disabled:opacity-50`}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save (Ctrl+S)
            </button>
          </div>
        </div>

        {/* Editor */}
        <main className="flex-1 overflow-hidden bg-gray-900">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-400">Loading TeX content...</span>
            </div>
          ) : error && !content ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <p className="text-red-400">{error}</p>
              <Link
                href={`/project?orgId=${orgId}&projectId=${projectId}&env=${env}`}
                className="text-blue-400 hover:underline"
              >
                Back to Project
              </Link>
            </div>
          ) : (
            <div className="h-full p-4">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-full bg-gray-800 text-gray-100 font-mono text-sm p-4 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none resize-none"
                placeholder="LaTeX content will appear here..."
                spellCheck={false}
              />
            </div>
          )}
        </main>

        {/* Footer help */}
        <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 text-gray-400 text-xs">
          <p>
            <strong>Tip:</strong> After saving, go back to the project pipeline and click
            &quot;Recompile TeX&quot; to regenerate the PDF with your changes.
            This will only recompile the LaTeX without re-running the full report generation.
          </p>
        </div>
      </div>
    </div>
  );
}
