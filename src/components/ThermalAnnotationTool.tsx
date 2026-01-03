'use client';
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Save,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Thermometer,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

// Coordinate system constants
const THERMAL_WIDTH = 640;
const THERMAL_HEIGHT = 512;
const VISUAL_WIDTH = 1280;
const VISUAL_HEIGHT = 1024;

// Severity colors
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#d97706',
  LOW: '#65a30d',
  MINIMAL: '#22c55e',
};

// Severity thresholds
function getSeverity(deltaT: number): string {
  if (deltaT >= 40) return 'CRITICAL';
  if (deltaT >= 25) return 'HIGH';
  if (deltaT >= 15) return 'MEDIUM';
  if (deltaT >= 10) return 'LOW';
  return 'MINIMAL';
}

// Coordinate conversion helpers
function visualToThermal(vx: number, vy: number): { x: number; y: number } {
  return {
    x: Math.round(vx * THERMAL_WIDTH / VISUAL_WIDTH),
    y: Math.round(vy * THERMAL_HEIGHT / VISUAL_HEIGHT),
  };
}

function thermalToVisual(tx: number, ty: number): { x: number; y: number } {
  return {
    x: Math.round(tx * VISUAL_WIDTH / THERMAL_WIDTH),
    y: Math.round(ty * VISUAL_HEIGHT / THERMAL_HEIGHT),
  };
}

interface AnnotationPoint {
  x: number;
  y: number;
  temp: number | null;
}

interface AnnotationEntry {
  defect_id: string;
  panel_id: string;
  defect_type: string;
  defect_index: number;
  raw_image_path: string;
  raw_image_name: string;
  annotated_image: string;
  hot_point: AnnotationPoint;
  cold_point: AnnotationPoint;
  delta_t: number;
  severity: string;
}

interface AnnotationManifest {
  project_id: string;
  user_id: string;
  generated_at: string;
  annotations: AnnotationEntry[];
}

interface AnnotationOverride {
  defect_id: string;
  hot_point: { x: number; y: number } | null;
  cold_point: { x: number; y: number } | null;
}

interface OverrideManifest {
  project_id: string;
  user_id: string;
  created_at: string;
  overrides: AnnotationOverride[];
}

interface ThermalAnnotationToolProps {
  orgId: string;
  projectId: string;
  env: string;
}

type PointMode = 'hot' | 'cold' | null;

export function ThermalAnnotationTool({ orgId, projectId, env }: ThermalAnnotationToolProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<AnnotationManifest | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Override state - stores modified points per defect
  const [overrides, setOverrides] = useState<Map<string, { hot?: AnnotationPoint; cold?: AnnotationPoint }>>(new Map());
  const [pointMode, setPointMode] = useState<PointMode>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Current annotation being viewed
  const currentAnnotation = manifest?.annotations[currentIndex] || null;

  // Get effective points (override or original)
  const getEffectivePoints = useCallback((annotation: AnnotationEntry | null) => {
    if (!annotation) return { hot: null, cold: null };
    const override = overrides.get(annotation.defect_id);
    return {
      hot: override?.hot || annotation.hot_point,
      cold: override?.cold || annotation.cold_point,
    };
  }, [overrides]);

  // Calculate delta T from effective points
  const getEffectiveDeltaT = useCallback((annotation: AnnotationEntry | null) => {
    const points = getEffectivePoints(annotation);
    if (!points.hot?.temp || !points.cold?.temp) return annotation?.delta_t || 0;
    return points.hot.temp - points.cold.temp;
  }, [getEffectivePoints]);

  // Fetch annotation manifest
  useEffect(() => {
    async function fetchManifest() {
      try {
        setLoading(true);
        setError(null);

        const bucket = env === 'prod' ? 'solar-reports-prod' : 'solar-reports-dev';
        const key = `${orgId}/projects/${projectId}/thermographic-report/annotation_manifest.json`;

        const response = await fetch(
          buildApiUrl(`/s3/presigned-url?bucket=${bucket}&key=${encodeURIComponent(key)}&operation=get`)
        );

        if (!response.ok) {
          throw new Error('Failed to get manifest URL');
        }

        const { url } = await response.json();
        const manifestResponse = await fetch(url);

        if (!manifestResponse.ok) {
          throw new Error('No annotation manifest found. Generate a report first.');
        }

        const data: AnnotationManifest = await manifestResponse.json();
        setManifest(data);

        // Also try to load existing overrides
        await loadExistingOverrides(bucket, orgId, projectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load annotations');
      } finally {
        setLoading(false);
      }
    }

    fetchManifest();
  }, [orgId, projectId, env]);

  // Load existing overrides from S3
  async function loadExistingOverrides(bucket: string, orgId: string, projectId: string) {
    try {
      const key = `${orgId}/projects/${projectId}/annotation_overrides.json`;
      const response = await fetch(
        buildApiUrl(`/s3/presigned-url?bucket=${bucket}&key=${encodeURIComponent(key)}&operation=get`)
      );

      if (!response.ok) return;

      const { url } = await response.json();
      const overridesResponse = await fetch(url);

      if (!overridesResponse.ok) return;

      const data: OverrideManifest = await overridesResponse.json();

      // Convert to our internal format
      const newOverrides = new Map<string, { hot?: AnnotationPoint; cold?: AnnotationPoint }>();
      for (const override of data.overrides) {
        newOverrides.set(override.defect_id, {
          hot: override.hot_point ? { ...override.hot_point, temp: null } : undefined,
          cold: override.cold_point ? { ...override.cold_point, temp: null } : undefined,
        });
      }
      setOverrides(newOverrides);
    } catch {
      // No existing overrides, that's fine
    }
  }

  // Get presigned URL for raw thermal image
  const getRawImageUrl = useCallback(async (imageName: string): Promise<string> => {
    const bucket = env === 'prod' ? 'solar-uploads-prod' : 'solar-uploads-dev';
    const key = `${orgId}/projects/${projectId}/images/${imageName}`;

    const response = await fetch(
      buildApiUrl(`/s3/presigned-url?bucket=${bucket}&key=${encodeURIComponent(key)}&operation=get`)
    );

    if (!response.ok) throw new Error('Failed to get image URL');
    const { url } = await response.json();
    return url;
  }, [orgId, projectId, env]);

  // Image URL state
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Load image when annotation changes
  useEffect(() => {
    if (!currentAnnotation) return;

    setImageLoaded(false);
    getRawImageUrl(currentAnnotation.raw_image_name)
      .then(setImageUrl)
      .catch((err) => setError(err.message));
  }, [currentAnnotation, getRawImageUrl]);

  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  // Handle click on image to set point
  const handleImageClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Don't place point if we were panning
    if (isPanning) return;
    if (!pointMode || !currentAnnotation || !containerRef.current || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    // Convert to thermal coordinates
    const thermal = visualToThermal(x, y);

    // Clamp to valid range
    thermal.x = Math.max(0, Math.min(THERMAL_WIDTH - 1, thermal.x));
    thermal.y = Math.max(0, Math.min(THERMAL_HEIGHT - 1, thermal.y));

    // Update override
    const existing = overrides.get(currentAnnotation.defect_id) || {};
    const newPoint: AnnotationPoint = { x: thermal.x, y: thermal.y, temp: null };

    setOverrides((prev) => {
      const newMap = new Map(prev);
      newMap.set(currentAnnotation.defect_id, {
        ...existing,
        [pointMode]: newPoint,
      });
      return newMap;
    });

    setHasChanges(true);
    setPointMode(null);
  }, [pointMode, currentAnnotation, zoom, overrides, isPanning]);

  // Pan handlers - click and hold to pan (only when no point mode is selected)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (pointMode) return; // Don't pan when placing points
    if (!containerRef.current) return;

    // Only left mouse button
    if (e.button !== 0) return;

    e.preventDefault(); // Prevent text selection while dragging
    setIsPanning(false); // Reset panning state
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };

    // Change cursor to grabbing
    containerRef.current.style.cursor = 'grabbing';
  }, [pointMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!panStartRef.current || !containerRef.current) return;

    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;

    // Only consider it panning if moved more than 3px (reduced threshold)
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      setIsPanning(true);
    }

    containerRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
    containerRef.current.scrollTop = panStartRef.current.scrollTop - dy;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (containerRef.current && !pointMode) {
      containerRef.current.style.cursor = 'grab';
    }
    // Delay resetting isPanning so click handler can check it
    setTimeout(() => {
      panStartRef.current = null;
      setIsPanning(false);
    }, 10);
  }, [pointMode]);

  const handleMouseLeave = useCallback(() => {
    if (containerRef.current && !pointMode) {
      containerRef.current.style.cursor = 'grab';
    }
    panStartRef.current = null;
    setIsPanning(false);
  }, [pointMode]);

  // Reset current annotation to original
  const handleReset = useCallback(() => {
    if (!currentAnnotation) return;

    setOverrides((prev) => {
      const newMap = new Map(prev);
      newMap.delete(currentAnnotation.defect_id);
      return newMap;
    });
    setHasChanges(true);
  }, [currentAnnotation]);

  // Save overrides to S3
  const handleSave = async () => {
    if (!manifest) return;

    try {
      setSaving(true);

      // Build override manifest
      const overrideList: AnnotationOverride[] = [];
      overrides.forEach((points, defectId) => {
        overrideList.push({
          defect_id: defectId,
          hot_point: points.hot ? { x: points.hot.x, y: points.hot.y } : null,
          cold_point: points.cold ? { x: points.cold.x, y: points.cold.y } : null,
        });
      });

      const overrideManifest: OverrideManifest = {
        project_id: projectId,
        user_id: orgId,
        created_at: new Date().toISOString(),
        overrides: overrideList,
      };

      // Get presigned URL for upload
      const bucket = env === 'prod' ? 'solar-reports-prod' : 'solar-reports-dev';
      const key = `${orgId}/projects/${projectId}/annotation_overrides.json`;

      const urlResponse = await fetch(
        buildApiUrl(`/s3/presigned-url?bucket=${bucket}&key=${encodeURIComponent(key)}&operation=put&contentType=application/json`)
      );

      if (!urlResponse.ok) throw new Error('Failed to get upload URL');
      const { url } = await urlResponse.json();

      // Upload
      const uploadResponse = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideManifest),
      });

      if (!uploadResponse.ok) throw new Error('Failed to upload overrides');

      setHasChanges(false);
      alert(`Saved ${overrideList.length} annotation overrides. Regenerate the report to apply changes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Navigation
  const goToPrevious = useCallback(() => {
    setCurrentIndex((idx) => (idx > 0 ? idx - 1 : idx));
  }, []);

  const goToNext = useCallback(() => {
    if (!manifest) return;
    setCurrentIndex((idx) => (idx < manifest.annotations.length - 1 ? idx + 1 : idx));
  }, [manifest]);

  // Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.2, 4));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.2, 0.5));
  const handleZoomReset = () => setZoom(1);

  // Mouse wheel zoom handler - use native event listener for non-passive
  // Re-run when loading completes so containerRef is populated
  const touchDistanceRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1; // Scroll down = zoom out, scroll up = zoom in
      setZoom((z) => Math.max(0.5, Math.min(4, z * delta)));
    };

    const getTouchDistance = (touches: TouchList): number => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        touchDistanceRef.current = getTouchDistance(e.touches);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchDistanceRef.current !== null) {
        e.preventDefault();
        const newDistance = getTouchDistance(e.touches);
        const scale = newDistance / touchDistanceRef.current;
        setZoom((z) => Math.max(0.5, Math.min(4, z * scale)));
        touchDistanceRef.current = newDistance;
      }
    };

    const handleTouchEnd = () => {
      touchDistanceRef.current = null;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [loading, manifest]); // Re-run when loading completes or manifest changes

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
      if (e.key === 'h' || e.key === 'H') setPointMode('hot');
      if (e.key === 'c' || e.key === 'C') setPointMode('cold');
      if (e.key === 'Escape') setPointMode(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, goToNext, goToPrevious, manifest]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading annotations...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!manifest || manifest.annotations.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Thermometer className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-700">No thermal annotations found.</p>
          <p className="text-gray-500 text-sm mt-2">Generate a report first to create annotations.</p>
        </div>
      </div>
    );
  }

  const points = getEffectivePoints(currentAnnotation);
  const deltaT = getEffectiveDeltaT(currentAnnotation);
  const severity = getSeverity(deltaT);
  const isModified = overrides.has(currentAnnotation?.defect_id || '');

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Top toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          {/* Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className="p-2 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5 text-gray-300" />
            </button>
            <span className="text-gray-300 text-sm min-w-[80px] text-center">
              {currentIndex + 1} / {manifest.annotations.length}
            </span>
            <button
              onClick={goToNext}
              disabled={currentIndex === manifest.annotations.length - 1}
              className="p-2 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5 text-gray-300" />
            </button>
          </div>

          {/* Defect selector dropdown */}
          <select
            value={currentIndex}
            onChange={(e) => setCurrentIndex(Number(e.target.value))}
            className="bg-gray-700 text-gray-200 rounded px-3 py-1.5 text-sm border border-gray-600"
          >
            {manifest.annotations.map((ann, idx) => (
              <option key={ann.defect_id} value={idx}>
                {ann.panel_id} - {ann.defect_type} #{ann.defect_index}
                {overrides.has(ann.defect_id) ? ' (modified)' : ''}
              </option>
            ))}
          </select>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 ml-4 border-l border-gray-700 pl-4">
            <button onClick={handleZoomOut} className="p-2 rounded hover:bg-gray-700">
              <ZoomOut className="w-4 h-4 text-gray-300" />
            </button>
            <span className="text-gray-400 text-sm min-w-[50px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={handleZoomIn} className="p-2 rounded hover:bg-gray-700">
              <ZoomIn className="w-4 h-4 text-gray-300" />
            </button>
            <button onClick={handleZoomReset} className="p-2 rounded hover:bg-gray-700">
              <RotateCcw className="w-4 h-4 text-gray-300" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Point mode buttons */}
          <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
            <button
              onClick={() => setPointMode(pointMode === 'hot' ? null : 'hot')}
              className={`px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 ${
                pointMode === 'hot'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-700 text-red-400 hover:bg-gray-600'
              }`}
            >
              <Crosshair className="w-4 h-4" />
              Hot (H)
            </button>
            <button
              onClick={() => setPointMode(pointMode === 'cold' ? null : 'cold')}
              className={`px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 ${
                pointMode === 'cold'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-blue-400 hover:bg-gray-600'
              }`}
            >
              <Crosshair className="w-4 h-4" />
              Cold (C)
            </button>
          </div>

          {/* Reset and Save */}
          <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
            <button
              onClick={handleReset}
              disabled={!isModified}
              className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-3 py-1.5 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Overrides
            </button>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Image viewer */}
        <div
          ref={containerRef}
          className={`flex-1 overflow-auto bg-gray-900 ${
            pointMode ? 'cursor-crosshair' : 'cursor-grab'
          }`}
          onClick={handleImageClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {imageUrl && (
            <div
              className="relative inline-block"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              <img
                ref={imageRef}
                src={imageUrl}
                alt={currentAnnotation?.raw_image_name}
                onLoad={() => setImageLoaded(true)}
                className="max-w-none"
                style={{ imageRendering: 'pixelated' }}
              />

              {/* Hot point marker */}
              {imageLoaded && points.hot && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: thermalToVisual(points.hot.x, points.hot.y).x - 15,
                    top: thermalToVisual(points.hot.x, points.hot.y).y - 15,
                  }}
                >
                  <div className="w-[30px] h-[30px] border-2 border-red-500 rounded-full flex items-center justify-center">
                    <div className="w-[6px] h-[6px] bg-red-500 rounded-full" />
                  </div>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap">
                    HOT {points.hot.temp?.toFixed(1) || '?'}°C
                  </div>
                </div>
              )}

              {/* Cold point marker */}
              {imageLoaded && points.cold && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: thermalToVisual(points.cold.x, points.cold.y).x - 15,
                    top: thermalToVisual(points.cold.x, points.cold.y).y - 15,
                  }}
                >
                  <div className="w-[30px] h-[30px] border-2 border-blue-500 rounded-full flex items-center justify-center">
                    <div className="w-[6px] h-[6px] bg-blue-500 rounded-full" />
                  </div>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap">
                    REF {points.cold.temp?.toFixed(1) || '?'}°C
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar - annotation details */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 p-4 overflow-y-auto">
          {currentAnnotation && (
            <div className="space-y-6">
              {/* Defect info */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  Panel {currentAnnotation.panel_id}
                </h3>
                <div className="text-sm text-gray-400 space-y-1">
                  <p>Type: <span className="text-gray-200">{currentAnnotation.defect_type}</span></p>
                  <p>Defect #{currentAnnotation.defect_index}</p>
                  <p className="text-xs text-gray-500 truncate" title={currentAnnotation.raw_image_name}>
                    Image: {currentAnnotation.raw_image_name}
                  </p>
                </div>
              </div>

              {/* Temperature readings */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-300">Temperature Analysis</h4>

                {/* Hot point */}
                <div className="bg-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-red-400 font-medium">Hot Point</span>
                    {isModified && overrides.get(currentAnnotation.defect_id)?.hot && (
                      <span className="text-xs bg-amber-600 text-white px-1.5 py-0.5 rounded">Modified</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-300">
                    <p>Position: ({points.hot?.x}, {points.hot?.y})</p>
                    <p className="text-lg font-bold text-red-400">
                      {points.hot?.temp?.toFixed(1) || '—'}°C
                    </p>
                  </div>
                </div>

                {/* Cold point */}
                <div className="bg-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-400 font-medium">Reference Point</span>
                    {isModified && overrides.get(currentAnnotation.defect_id)?.cold && (
                      <span className="text-xs bg-amber-600 text-white px-1.5 py-0.5 rounded">Modified</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-300">
                    <p>Position: ({points.cold?.x}, {points.cold?.y})</p>
                    <p className="text-lg font-bold text-blue-400">
                      {points.cold?.temp?.toFixed(1) || '—'}°C
                    </p>
                  </div>
                </div>

                {/* Delta T */}
                <div
                  className="rounded-lg p-3"
                  style={{ backgroundColor: `${SEVERITY_COLORS[severity]}20` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300 font-medium">Delta T</span>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ backgroundColor: SEVERITY_COLORS[severity], color: 'white' }}
                    >
                      {severity}
                    </span>
                  </div>
                  <p
                    className="text-2xl font-bold mt-1"
                    style={{ color: SEVERITY_COLORS[severity] }}
                  >
                    {deltaT.toFixed(1)}°C
                  </p>
                </div>
              </div>

              {/* Instructions */}
              <div className="border-t border-gray-700 pt-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Instructions</h4>
                <ul className="text-xs text-gray-500 space-y-1">
                  <li>• Press <kbd className="bg-gray-700 px-1 rounded">H</kbd> then click to set hot point</li>
                  <li>• Press <kbd className="bg-gray-700 px-1 rounded">C</kbd> then click to set cold point</li>
                  <li>• Click and hold to pan the image</li>
                  <li>• Scroll wheel to zoom in/out</li>
                  <li>• Use <kbd className="bg-gray-700 px-1 rounded">←</kbd> <kbd className="bg-gray-700 px-1 rounded">→</kbd> to navigate</li>
                  <li>• Press <kbd className="bg-gray-700 px-1 rounded">Esc</kbd> to cancel placement</li>
                </ul>
              </div>

              {/* Status */}
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center gap-2">
                  {isModified ? (
                    hasChanges ? (
                      <>
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-amber-400">Modified (unsaved)</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-green-400">Modified (saved)</span>
                      </>
                    )
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-400">Original annotation</span>
                    </>
                  )}
                </div>
                {hasChanges && (
                  <p className="text-xs text-amber-400 mt-2">
                    You have unsaved changes. Click &quot;Save Overrides&quot; to persist.
                  </p>
                )}
              </div>

              {/* Summary of all overrides */}
              {overrides.size > 0 && (
                <div className="border-t border-gray-700 pt-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">
                    {hasChanges ? 'Pending' : 'Saved'} Overrides ({overrides.size})
                  </h4>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {Array.from(overrides.keys()).map((defectId) => {
                      const ann = manifest.annotations.find((a) => a.defect_id === defectId);
                      return (
                        <button
                          key={defectId}
                          onClick={() => {
                            const idx = manifest.annotations.findIndex((a) => a.defect_id === defectId);
                            if (idx >= 0) setCurrentIndex(idx);
                          }}
                          className="w-full text-left text-xs bg-gray-700 hover:bg-gray-600 rounded px-2 py-1 text-gray-300"
                        >
                          {ann?.panel_id} - {ann?.defect_type} #{ann?.defect_index}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Point mode indicator */}
      {pointMode && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-white font-medium ${
            pointMode === 'hot' ? 'bg-red-600' : 'bg-blue-600'
          }`}
        >
          Click on image to place {pointMode === 'hot' ? 'HOT' : 'COLD'} point
          <button
            onClick={() => setPointMode(null)}
            className="ml-3 text-white/70 hover:text-white"
          >
            (Esc to cancel)
          </button>
        </div>
      )}
    </div>
  );
}
