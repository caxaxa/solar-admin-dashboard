'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCcw, Rocket, ShieldCheck, Play, AlertCircle } from 'lucide-react';
import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { buildApiUrl, apiFetch } from '@/lib/api-client';

type ModelRecord = {
  model_version: string;
  status?: string;
  manifest_uri?: string;
  base_model_version?: string;
  created_at?: number;
  created_by?: string;
  is_production?: boolean;
  promoted_at?: number;
  promoted_by?: string;
};

type Archive = {
  project_id?: string;
  org_id?: string;
  released_at?: string;
  archived_files?: string[];
  metadata_uri: string;
  date?: string;
  training_status?: 'trained' | 'untrained';
  trained_in_model?: string;
  trained_at?: string;
};

export default function ModelPage() {
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [productionModel, setProductionModel] = useState<string | null>(null);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [trainedCount, setTrainedCount] = useState(0);
  const [untrainedCount, setUntrainedCount] = useState(0);
  const [manifestUri, setManifestUri] = useState<string>('');
  const [epochs, setEpochs] = useState<string>('5');
  const [batchSize, setBatchSize] = useState<string>('2');
  const [lastModelVersion, setLastModelVersion] = useState<string>('');
  const [datasetUri, setDatasetUri] = useState<string>('');
  const [datasetReady, setDatasetReady] = useState<boolean>(false);
  const [checkingDataset, setCheckingDataset] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const MAX_POLL_ATTEMPTS = 120;

  const getErrorMessage = (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback;

  const fetchModels = useCallback(async () => {
    setError(null);
    const resp = await apiFetch(buildApiUrl('/api/model-registry'));
    if (!resp.ok) throw new Error('Failed to fetch model registry');
    const data = await resp.json();
    setModels(data.models || []);
    setProductionModel(data.production_model || null);
  }, []);

  const fetchArchives = useCallback(async () => {
    setError(null);
    const resp = await apiFetch(buildApiUrl('/api/training-data/archives'));
    if (!resp.ok) throw new Error('Failed to fetch training archives');
    const data = await resp.json();
    setArchives(data.archives || []);
    setTrainedCount(data.trained_count || 0);
    setUntrainedCount(data.untrained_count || 0);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchModels(), fetchArchives()]);
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  }, [fetchModels, fetchArchives]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const latestManifest = useMemo(() => {
    if (archives.length === 0) return '';
    return archives[0].metadata_uri;
  }, [archives]);

  const prepareJob = async () => {
    const epochsInt = parseInt(epochs, 10);
    const batchSizeInt = parseInt(batchSize, 10);
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await apiFetch(buildApiUrl('/api/model-registry/prepare'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epochs: epochsInt > 0 ? epochsInt : undefined,
          batch_size: batchSizeInt > 0 ? batchSizeInt : undefined,
        }),
      });
      if (!resp.ok) throw new Error('Failed to prepare retrain');
      const data = await resp.json();
      if (data?.model_version) {
        setLastModelVersion(data.model_version);
      }
      if (data?.dataset_archive_uri) {
        setDatasetUri(data.dataset_archive_uri);
        setDatasetReady(false);
      }
      if (data?.manifest_uri) {
        setManifestUri(data.manifest_uri);
      }
      await refreshAll();
      setSuccess('Prepared: manifest saved, COCO build queued, registry entry created.');
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Prepare failed'));
    } finally {
      setBusy(false);
    }
  };

  const checkDatasetReady = useCallback(
    async (uri: string): Promise<boolean> => {
      setCheckingDataset(true);
      try {
        const resp = await apiFetch(buildApiUrl('/api/training-data/coco/status'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset_uri: uri }),
        });
        if (!resp.ok) throw new Error('Failed to check dataset readiness');
        const data = await resp.json();
        const ready = Boolean(data.exists);
        setDatasetReady(ready);
        return ready;
      } catch (e) {
        console.error('Dataset readiness check failed', e);
        setDatasetReady(false);
        return false;
      } finally {
        setCheckingDataset(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let attempts = 0;

    if (!datasetUri) {
      setDatasetReady(false);
      setPollCount(0);
      return () => {};
    }

    const poll = async () => {
      attempts++;
      setPollCount(attempts);
      const ready = await checkDatasetReady(datasetUri);
      if (!cancelled && !ready) {
        if (attempts >= MAX_POLL_ATTEMPTS) {
          setError('COCO build timed out after 10 minutes. Check Batch job logs for errors, then retry.');
          return;
        }
        timeoutId = window.setTimeout(poll, 5000);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [datasetUri, checkDatasetReady]);

  const launchBatchJob = async () => {
    if (!lastModelVersion) {
      setError('Prepare a retrain first.');
      return;
    }
    if (!datasetReady) {
      setError('COCO build is still running. Please wait until the dataset tar is ready.');
      return;
    }
    setLaunchBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, string | number | undefined> = {
        manifest_uri: manifestUri || undefined,
        dataset_archive_uri: datasetUri || undefined,
        epochs: parseInt(epochs, 10) || undefined,
        batch_size: parseInt(batchSize, 10) || undefined,
      };

      const resp = await apiFetch(buildApiUrl(`/api/model-registry/${lastModelVersion}/launch`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('Failed to launch Batch job');
      await refreshAll();
      setSuccess('Batch job submitted. Monitor Batch queue and CloudWatch logs.');
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Batch launch failed'));
    } finally {
      setLaunchBusy(false);
    }
  };

  const promoteModel = async (modelVersion: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await apiFetch(buildApiUrl(`/api/model-registry/${modelVersion}/promote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Promoted via admin UI' }),
      });
      if (!resp.ok) throw new Error('Failed to promote model');
      await refreshAll();
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Promotion failed'));
    } finally {
      setBusy(false);
    }
  };

  const deleteModel = async (modelVersion: string) => {
    if (!confirm(`Delete model ${modelVersion}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await apiFetch(buildApiUrl(`/api/model-registry/${modelVersion}`), {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error('Failed to delete model');
      await refreshAll();
      setSuccess('Model deleted');
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 p-6 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">AI Model</h1>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Simple flow: Prepare (manifest + COCO + registry), Run Batch, Promote.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={refreshAll}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                disabled={busy}
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              <span>{success}</span>
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-5 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Prepare</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">One click: manifest + COCO + registry.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Epochs</label>
                <input
                  type="number"
                  min={1}
                  value={epochs}
                  onChange={(e) => setEpochs(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                  placeholder="e.g. 5"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Batch size</label>
                <input
                  type="number"
                  min={1}
                  value={batchSize}
                  onChange={(e) => setBatchSize(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                  placeholder="e.g. 2"
                />
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={prepareJob}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Prepare job
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-5 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Run Batch job</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Use prepared manifest + dataset, then train.
                  {datasetUri && (
                    <span className="ml-2 text-xs text-gray-500">
                      {datasetReady
                        ? 'Dataset ready.'
                        : checkingDataset
                        ? 'Checking dataset status...'
                        : 'Waiting for COCO build to finish.'}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Model version</label>
                <input
                  value={lastModelVersion}
                  onChange={(e) => setLastModelVersion(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                  placeholder="model-..."
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Prepared dataset</label>
                <input
                  value={datasetUri}
                  onChange={(e) => setDatasetUri(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                  placeholder="Prepared COCO tar"
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Prepared manifest</label>
              <input
                value={manifestUri || latestManifest}
                onChange={(e) => setManifestUri(e.target.value)}
                className="mt-1 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                placeholder="Prepared manifest"
              />
            </div>
            <div className="mt-4">
              <button
                onClick={launchBatchJob}
                disabled={launchBusy || !datasetReady}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {launchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {datasetReady ? 'Run Batch job' : 'Waiting for COCO tar...'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-5 border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Models</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Registry entries and production pointer
                </p>
              </div>
              {productionModel && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded bg-green-100 text-green-800 text-sm">
                  <ShieldCheck className="h-4 w-4" />
                  Prod: {productionModel}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="py-2 pr-3">Version</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Manifest</th>
                    <th className="py-2 pr-3">Base</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.model_version} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-50">
                        {m.model_version}
                        {m.is_production && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                            Prod
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{m.status || 'unknown'}</td>
                      <td className="py-2 pr-3">
                        {m.manifest_uri ? (
                          <Link
                            href={m.manifest_uri}
                            className="text-blue-600 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            manifest
                          </Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2 pr-3">{m.base_model_version || '-'}</td>
                      <td className="py-2 pr-3">
                        {m.created_at ? new Date(m.created_at * 1000).toLocaleString() : '-'}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          {!m.is_production && (
                            <button
                              onClick={() => promoteModel(m.model_version)}
                              disabled={busy}
                              className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                            >
                              Promote
                            </button>
                          )}
                          {!m.is_production && (
                            <button
                              onClick={() => deleteModel(m.model_version)}
                              disabled={busy}
                              className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-5 border border-gray-100 dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Training archives</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Released projects available for retraining
                </p>
              </div>
              {archives.length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium">
                    {trainedCount} trained
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                    {untrainedCount} untrained
                  </span>
                </div>
              )}
            </div>
            {archives.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">No archives found.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {archives.map((a) => (
                  <div
                    key={a.metadata_uri}
                    className={`border rounded-lg p-4 bg-white dark:bg-gray-900 ${
                      a.training_status === 'trained'
                        ? 'border-green-200 dark:border-green-900'
                        : 'border-amber-200 dark:border-amber-900'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                        {a.project_id || 'Project'} {a.org_id ? `• ${a.org_id}` : ''}
                      </div>
                      {a.training_status === 'trained' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">
                          Trained
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
                          Untrained
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {a.date || ''} {a.released_at ? `• ${a.released_at}` : ''}
                      {a.trained_in_model && (
                        <span className="ml-2 text-green-600">• {a.trained_in_model}</span>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-blue-600 break-all">
                      <Link href={a.metadata_uri} target="_blank" className="hover:underline">
                        {a.metadata_uri}
                      </Link>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      {a.archived_files?.length || 0} files
                    </div>
                    {a.archived_files && a.archived_files.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {a.archived_files.slice(0, 4).map((f) => (
                          <div key={f} className="text-[11px] text-gray-500 break-all">
                            • {f}
                          </div>
                        ))}
                        {a.archived_files.length > 4 && (
                          <div className="text-[11px] text-gray-400">
                            +{a.archived_files.length - 4} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
