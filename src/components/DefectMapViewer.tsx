'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ZoomIn, ZoomOut, RotateCcw, X, MapPin, Thermometer } from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

// Defect class colors (matching report builder)
const DEFECT_COLORS: Record<string, string> = {
  hotspots: '#FF4444',
  faultydiodes: '#FF8C00',
  offlinepanels: '#FFD700',
};

// Defect class display names
const DEFECT_LABELS: Record<string, string> = {
  hotspots: 'Ponto Quente (Hot Spot)',
  faultydiodes: 'Diodo de Bypass Queimado',
  offlinepanels: 'Painel Desligado',
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

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Fetch defect map data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          buildApiUrl(`/projects/${projectId}/defect-map`)
        );

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

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setScale(s => Math.min(s * 1.5, 10));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(s => Math.max(s / 1.5, 0.1));
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.min(Math.max(s * delta, 0.1), 10));
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

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
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
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
        className="relative flex-1 overflow-hidden bg-gray-900 cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
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
                    {/* Clickable/hoverable rectangle */}
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
                    {/* Bright fill on hover/select */}
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
}

function DefectPopup({ defect, isPinned, onClose }: DefectPopupProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const color = DEFECT_COLORS[defect.defect_class] || '#FFFFFF';

  return (
    <div
      className={`absolute bottom-4 right-4 bg-gray-800 rounded-lg shadow-xl border border-gray-700 w-80 overflow-hidden ${
        isPinned ? 'ring-2 ring-blue-500' : ''
      }`}
    >
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
  );
}
