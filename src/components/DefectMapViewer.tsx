'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ZoomIn, ZoomOut, RotateCcw, X, MapPin, Thermometer } from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';
import { useIsomorphicLayoutEffect } from '@/lib/useIsomorphicLayoutEffect';

// Defect class colors (matching report builder)
const DEFECT_COLORS: Record<string, string> = {
  hotspots: '#FF4444',
  faultydiodes: '#FF8C00',
  offlinepanels: '#FFD700',
};

// Defect class display names
const DEFECT_LABELS: Record<string, string> = {
  hotspots: 'Hot Spot',
  faultydiodes: 'Faulty Diode',
  offlinepanels: 'Offline Panel',
};

interface BboxScaled {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DefectInfo {
  defect_id: string;
  panel_id: string;
  column: number;
  row: number;
  defect_class: string;
  display_class: string;
  latitude?: number;
  longitude?: number;
  bbox_scaled?: BboxScaled;
  thermal_image_url?: string;
}

interface DefectMapData {
  ortho_url: string;
  ortho_width: number;
  ortho_height: number;
  defects: DefectInfo[];
}

interface DefectMapViewerProps {
  projectId: string;
}

export function DefectMapViewer({ projectId }: DefectMapViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapData, setMapData] = useState<DefectMapData | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedDefect, setSelectedDefect] = useState<DefectInfo | null>(null);
  const [hoveredDefect, setHoveredDefect] = useState<DefectInfo | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isMobile, setIsMobile] = useState(false);
  const [pointerState, setPointerState] = useState<{
    primaryId: number | null;
    secondaryId: number | null;
    lastTap?: number;
  }>({ primaryId: null, secondaryId: null });

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointerCache = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ distance: number; scale: number } | null>(null);

  // Fetch defect map data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(buildApiUrl(`/projects/${projectId}/defect-map`));

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to load defect map');
        }

        const data: DefectMapData = await response.json();
        setMapData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load defect map');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  // Track size + mobile breakpoint
  useEffect(() => {
    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
      setIsMobile(window.innerWidth < 768);
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const clampPosition = useCallback(
    (nextX: number, nextY: number, nextScale: number) => {
      if (!mapData) return { x: nextX, y: nextY };
      const imgW = mapData.ortho_width * nextScale;
      const imgH = mapData.ortho_height * nextScale;
      const { width: cw, height: ch } = containerSize;

      const minX = Math.min(0, cw - imgW);
      const minY = Math.min(0, ch - imgH);

      return {
        x: Math.min(0, Math.max(minX, nextX)),
        y: Math.min(0, Math.max(minY, nextY)),
      };
    },
    [containerSize, mapData]
  );

  const centerPosition = useCallback(
    (nextScale: number) => {
      if (!mapData) return { x: 0, y: 0 };
      const imgW = mapData.ortho_width * nextScale;
      const imgH = mapData.ortho_height * nextScale;
      const { width: cw, height: ch } = containerSize;
      const x = Math.min(0, (cw - imgW) / 2);
      const y = Math.min(0, (ch - imgH) / 2);
      return clampPosition(x, y, nextScale);
    },
    [mapData, containerSize, clampPosition]
  );

  // Zoom handlers
  const applyZoomAtPoint = useCallback(
    (deltaScale: number, clientX: number, clientY: number) => {
      if (!containerRef.current || !mapData) return;
      setScale((prevScale) => {
        const nextScale = Math.min(Math.max(prevScale * deltaScale, 0.1), 10);
        const rect = containerRef.current!.getBoundingClientRect();
        const originX = (clientX - rect.left - position.x) / prevScale;
        const originY = (clientY - rect.top - position.y) / prevScale;

        const nextX = clientX - rect.left - originX * nextScale;
        const nextY = clientY - rect.top - originY * nextScale;
        setPosition(clampPosition(nextX, nextY, nextScale));
        return nextScale;
      });
    },
    [clampPosition, mapData, position.x, position.y]
  );

  const handleZoomIn = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    applyZoomAtPoint(1.5, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoomAtPoint]);

  const handleZoomOut = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    applyZoomAtPoint(1 / 1.5, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [applyZoomAtPoint]);

  const handleReset = useCallback(() => {
    setScale(1);
    setPosition(centerPosition(1));
  }, [centerPosition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !mapData) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      applyZoomAtPoint(delta, e.clientX, e.clientY);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [mapData, applyZoomAtPoint]);

  // Pointer + touch handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const isPrimary = pointerState.primaryId === null;
      const isSecondary = pointerState.primaryId !== null && pointerState.secondaryId === null;

      if (isPrimary) {
        setPointerState((prev) => ({ ...prev, primaryId: e.pointerId }));
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      } else if (isSecondary) {
        setPointerState((prev) => ({ ...prev, secondaryId: e.pointerId }));
      }

      pointerCache.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (isSecondary) {
        const points = Array.from(pointerCache.current.values());
        if (points.length === 2) {
          const [p1, p2] = points;
          pinchState.current = { distance: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale };
        }
      }
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      if (e.pointerType === 'touch') {
        const now = Date.now();
        if (pointerState.lastTap && now - pointerState.lastTap < 350 && pointerState.secondaryId === null) {
          applyZoomAtPoint(1.35, e.clientX, e.clientY);
        }
        setPointerState((prev) => ({ ...prev, lastTap: now }));
      }
    },
    [applyZoomAtPoint, pointerState.primaryId, pointerState.secondaryId, pointerState.lastTap, position.x, position.y, scale]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerCache.current.has(e.pointerId)) return;
      pointerCache.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const points = Array.from(pointerCache.current.values());
      if (points.length === 2 && pointerState.primaryId !== null && pointerState.secondaryId !== null) {
        if (!pinchState.current) return;
        const [p1, p2] = points;
        const currentDistance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (pinchState.current.distance === 0) return;
        const delta = currentDistance / pinchState.current.distance;
        const scaleDelta = (pinchState.current.scale * delta) / scale;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        applyZoomAtPoint(scaleDelta, midX, midY);
        return;
      }

      if (!isDragging) return;
      setPosition((prev) => {
        const nextX = e.clientX - dragStart.x;
        const nextY = e.clientY - dragStart.y;
        return clampPosition(nextX, nextY, scale);
      });
    },
    [applyZoomAtPoint, clampPosition, dragStart.x, dragStart.y, isDragging, pointerState.primaryId, pointerState.secondaryId, scale]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointerCache.current.delete(e.pointerId);
      if (pointerCache.current.size < 2) {
        pinchState.current = null;
      }
      setIsDragging(false);

      setPointerState((prev) => {
        const next = { ...prev };
        if (prev.primaryId === e.pointerId) next.primaryId = null;
        if (prev.secondaryId === e.pointerId) next.secondaryId = null;
        return next;
      });
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    },
    []
  );

  // Close popup on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedDefect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (mapData && imageLoaded) {
      setPosition((prev) => clampPosition(prev.x, prev.y, scale));
    }
  }, [clampPosition, imageLoaded, mapData, scale]);

  useIsomorphicLayoutEffect(() => {
    if (mapData) {
      setPosition(centerPosition(scale));
    }
  }, [centerPosition, mapData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-gray-900 rounded-lg">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <span className="text-gray-400">Loading defect map...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-gray-900 rounded-lg">
        <div className="flex flex-col items-center gap-4 text-center px-4">
          <div className="text-red-500 text-lg font-medium">Failed to load defect map</div>
          <div className="text-gray-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!mapData) return null;

  const activeDefect = selectedDefect || hoveredDefect;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            {mapData.defects.length} defects found
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomOut}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm text-gray-400 w-16 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-white ml-2"
            title="Reset view"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4">
          {Object.entries(DEFECT_COLORS).map(([key, color]) => (
            <div key={key} className="flex items-center gap-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-gray-400">
                {key === 'hotspots' ? 'Hot Spots' : key === 'faultydiodes' ? 'Faulty Diodes' : 'Offline'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Map container */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-gray-900 cursor-grab active:cursor-grabbing touch-none"
        style={{ minHeight: isMobile ? '320px' : '500px', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Image and SVG overlay */}
        <div
          className="absolute"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Orthophoto image */}
          <img
            ref={imageRef}
            src={mapData.ortho_url}
            alt="Annotated orthophoto"
            className="max-w-none"
            style={{
              width: mapData.ortho_width,
              height: mapData.ortho_height,
            }}
            onLoad={() => setImageLoaded(true)}
            draggable={false}
          />

          {/* SVG overlay for defect markers */}
          {imageLoaded && (
            <svg
              className="absolute top-0 left-0 pointer-events-none"
              width={mapData.ortho_width}
              height={mapData.ortho_height}
              style={{ overflow: 'visible' }}
            >
              {mapData.defects.map((defect) => {
                if (!defect.bbox_scaled) return null;
                const { left, top, width, height } = defect.bbox_scaled;
                const color = DEFECT_COLORS[defect.defect_class] || '#FFFFFF';
                const isActive = activeDefect?.defect_id === defect.defect_id;

                return (
                  <g key={defect.defect_id}>
                    <rect
                      x={left}
                      y={top}
                      width={width}
                      height={height}
                      fill="transparent"
                      stroke={color}
                      strokeWidth={isActive ? 4 : 2}
                      className="pointer-events-auto cursor-pointer transition-all"
                      style={{
                        filter: isActive ? `drop-shadow(0 0 8px ${color})` : undefined,
                      }}
                      onMouseEnter={() => setHoveredDefect(defect)}
                      onMouseLeave={() => setHoveredDefect(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDefect(defect);
                      }}
                    />
                    {isActive && (
                      <rect
                        x={left}
                        y={top}
                        width={width}
                        height={height}
                        fill={color}
                        fillOpacity={0.3}
                        className="pointer-events-none"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Loading indicator for image */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}
      </div>

      {/* Defect popup */}
      {activeDefect && (
        <DefectPopup
          defect={activeDefect}
          isPinned={selectedDefect !== null}
          onClose={() => setSelectedDefect(null)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

// Defect popup component
interface DefectPopupProps {
  defect: DefectInfo;
  isPinned: boolean;
  onClose: () => void;
  isMobile: boolean;
}

function DefectPopup({ defect, isPinned, onClose, isMobile }: DefectPopupProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const color = DEFECT_COLORS[defect.defect_class] || '#FFFFFF';

  const sheetClasses = isMobile
    ? 'fixed inset-x-0 bottom-0 z-20 bg-gray-800 rounded-t-2xl shadow-2xl border border-gray-700 w-full max-h-[80vh]'
    : 'absolute bottom-4 right-4 bg-gray-800 rounded-lg shadow-xl border border-gray-700 w-80 overflow-hidden';

  const backdrop = isMobile ? (
    <div
      className="fixed inset-0 z-10 bg-black/40"
      onClick={onClose}
      aria-hidden="true"
    />
  ) : null;

  return (
    <>
      {backdrop}
      <div className={`${sheetClasses} ${isPinned && !isMobile ? 'ring-2 ring-blue-500' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="font-medium text-white text-sm">
              {defect.display_class || DEFECT_LABELS[defect.defect_class] || defect.defect_class}
            </span>
          </div>
          {isPinned && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-700 rounded"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          )}
        </div>

        {/* Thermal image */}
        {defect.thermal_image_url && (
          <div className="relative bg-gray-900 aspect-video">
            {imageLoading && !imageError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            )}
            {imageError ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                <Thermometer className="h-8 w-8" />
              </div>
            ) : (
              <img
                src={defect.thermal_image_url}
                alt="Thermal image"
                className={`w-full h-full object-contain ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                onLoad={() => setImageLoading(false)}
                onError={() => {
                  setImageLoading(false);
                  setImageError(true);
                }}
              />
            )}
          </div>
        )}

        {/* Details */}
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Panel:</span>
            <span className="text-white font-mono">{defect.panel_id}</span>
          </div>

          {(defect.latitude !== undefined && defect.longitude !== undefined) && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-gray-400" />
              <span className="text-gray-300 font-mono text-xs">
                {defect.latitude.toFixed(6)}, {defect.longitude.toFixed(6)}
              </span>
            </div>
          )}

          {defect.thermal_image_url && (
            <a
              href={defect.thermal_image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded mt-2"
            >
              View Full Image
            </a>
          )}
        </div>
      </div>
    </>
  );
}
