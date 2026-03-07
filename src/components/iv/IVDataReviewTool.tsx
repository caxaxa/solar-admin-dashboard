'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { buildApiUrl, apiFetch } from '@/lib/api-client';

interface IVDataReviewToolProps {
  orgId: string;
  projectId: string;
  env: string;
}

interface IVMeasurement {
  stringId: string;
  dateTime: string;
  pmax: number | null;
  voc: number | null;
  isc: number | null;
  fillFactor: number | null;
  performanceFactor: number | null;
  irradiance: number | null;
  cellTemp: number | null;
  sourceFile: string;
}

export function IVDataReviewTool({ orgId, projectId, env }: IVDataReviewToolProps) {
  const [measurements, setMeasurements] = useState<IVMeasurement[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(
        buildApiUrl(`/iv/projects/${orgId}/${projectId}/data-review?env=${env}`)
      );
      if (!resp.ok) throw new Error('Failed to fetch IV data');
      const data = await resp.json();
      setMeasurements(data.measurements || []);
      setTotalFiles(data.totalFiles || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [orgId, projectId, env]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleMarkComplete = async () => {
    if (!confirm('Mark this review as complete? This will advance the project pipeline.')) return;
    setCompleting(true);
    try {
      const resp = await apiFetch(
        buildApiUrl(`/iv/projects/${orgId}/${projectId}/actions/complete-review?env=${env}`),
        { method: 'POST' }
      );
      if (!resp.ok) throw new Error('Failed to complete review');
      const data = await resp.json();
      setCompleteMessage(data.message || 'Review marked complete');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to complete review');
    } finally {
      setCompleting(false);
    }
  };

  const cellClass = (value: number | null, type: 'pf' | 'ff'): string => {
    if (value === null) return '';
    if (type === 'pf' && value < 95) return 'bg-red-100 text-red-800 font-medium';
    if (type === 'ff' && value < 70) return 'bg-red-100 text-red-800 font-medium';
    return '';
  };

  const fmt = (v: number | null, decimals = 2): string => {
    if (v === null || isNaN(v)) return '-';
    return v.toFixed(decimals);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading IV measurement data...</span>
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {measurements.length} measurement(s) from {totalFiles} file(s)
        </div>
        <button
          onClick={handleMarkComplete}
          disabled={completing}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {completing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Mark Review Complete
        </button>
      </div>

      {completeMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm">
          {completeMessage}
        </div>
      )}

      {measurements.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No IV measurement data found. Upload data files (.pvapx or .csv) to the project first.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  String ID
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pmax (W)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Voc (V)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Isc (A)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fill Factor
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  PF (%)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Irradiance (W/m²)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cell Temp (°C)
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date/Time
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {measurements.map((m, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap">
                    {m.stringId}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 text-right whitespace-nowrap">
                    {fmt(m.pmax, 1)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 text-right whitespace-nowrap">
                    {fmt(m.voc, 2)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 text-right whitespace-nowrap">
                    {fmt(m.isc, 3)}
                  </td>
                  <td className={`px-4 py-2 text-sm text-right whitespace-nowrap ${cellClass(m.fillFactor, 'ff')}`}>
                    {fmt(m.fillFactor, 1)}
                  </td>
                  <td className={`px-4 py-2 text-sm text-right whitespace-nowrap ${cellClass(m.performanceFactor, 'pf')}`}>
                    {fmt(m.performanceFactor, 1)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 text-right whitespace-nowrap">
                    {fmt(m.irradiance, 0)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 text-right whitespace-nowrap">
                    {fmt(m.cellTemp, 1)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500 whitespace-nowrap">
                    {m.dateTime || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
