'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, Rect, Image as FabricImage, Point } from 'fabric';
import {
  Save,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Square,
  Trash2,
  Hand,
  Pointer,
  Undo2,
  Redo2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

interface ELAnnotationToolProps {
  orgId: string;
  projectId: string;
  env: string;
}

interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

// --- Label configuration ---------------------------------------------------
type DefectLabel = 'crack' | 'micro-crack';

const LABEL_CONFIG: Record<DefectLabel, { color: string; display: string; key: string }> = {
  crack:        { color: '#ef4444', display: 'Crack',       key: '1' },
  'micro-crack': { color: '#f59e0b', display: 'Micro-crack', key: '2' },
};

const LABELS = Object.keys(LABEL_CONFIG) as DefectLabel[];
const DEFAULT_LABEL: DefectLabel = 'crack';

function labelColor(label: string): string {
  return (LABEL_CONFIG as Record<string, { color: string }>)[label]?.color ?? '#ef4444';
}

function createAnnotationRect(box: { left: number; top: number; width: number; height: number; label: string }): Rect {
  const color = labelColor(box.label);
  const rect = new Rect({
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    fill: 'transparent',
    stroke: color,
    strokeWidth: 2,
    cornerColor: color,
    cornerSize: 8,
    transparentCorners: false,
  });
  (rect as any).label = box.label;
  return rect;
}

export function ELAnnotationTool({ orgId, projectId, env }: ELAnnotationToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boxCount, setBoxCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isDrawMode, setIsDrawMode] = useState(true);
  const [activeLabel, setActiveLabel] = useState<DefectLabel>(DEFAULT_LABEL);

  // Image navigation state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [currentFilename, setCurrentFilename] = useState('');

  // Drawing refs
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentRectRef = useRef<Rect | null>(null);
  const activeLabelRef = useRef<DefectLabel>(DEFAULT_LABEL);

  // Undo/Redo
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep label ref in sync with state
  useEffect(() => {
    activeLabelRef.current = activeLabel;
  }, [activeLabel]);

  const updateBoxCount = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const count = canvas.getObjects().filter(obj => obj.type === 'rect').length;
    setBoxCount(count);
  }, []);

  const saveUndoState = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const state = JSON.stringify(
      canvas.getObjects()
        .filter(obj => obj.type === 'rect')
        .map(obj => ({
          left: obj.left, top: obj.top,
          width: (obj as Rect).width * (obj.scaleX || 1),
          height: (obj as Rect).height * (obj.scaleY || 1),
          label: (obj as any).label || DEFAULT_LABEL,
        }))
    );
    undoStackRef.current.push(state);
    redoStackRef.current = [];
  }, []);

  const collectBoxes = useCallback((): BoundingBox[] => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return [];
    return canvas.getObjects()
      .filter(obj => obj.type === 'rect')
      .map(obj => ({
        left: Math.round(obj.left!),
        top: Math.round(obj.top!),
        width: Math.round((obj as Rect).width! * (obj.scaleX || 1)),
        height: Math.round((obj as Rect).height! * (obj.scaleY || 1)),
        label: (obj as any).label || DEFAULT_LABEL,
      }));
  }, []);

  // Count boxes by label
  const countByLabel = useCallback((): Record<string, number> => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return {};
    const counts: Record<string, number> = {};
    canvas.getObjects().filter(obj => obj.type === 'rect').forEach(obj => {
      const lbl = (obj as any).label || DEFAULT_LABEL;
      counts[lbl] = (counts[lbl] || 0) + 1;
    });
    return counts;
  }, []);

  // Load image + annotations for a given index
  const loadImage = useCallback(async (imageIndex: number) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(
        buildApiUrl(`/el/projects/${orgId}/${projectId}/annotations?env=${env}&imageIndex=${imageIndex}`)
      );
      if (!resp.ok) throw new Error('Failed to load EL image data');
      const data = await resp.json();

      setTotalImages(data.totalImages || 0);
      setCurrentIndex(data.currentIndex ?? imageIndex);
      setCurrentFilename(data.filename || `Image ${imageIndex + 1}`);

      // Clear existing objects
      canvas.getObjects().slice().forEach(obj => canvas.remove(obj));

      // Load image onto canvas
      if (data.imageUrl) {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const fabricImg = new FabricImage(img);
          const containerWidth = canvas.getWidth();
          const containerHeight = canvas.getHeight();
          const scale = Math.min(
            containerWidth / img.width,
            containerHeight / img.height,
            1
          );
          fabricImg.set({
            left: 0, top: 0,
            scaleX: scale, scaleY: scale,
            selectable: false, evented: false,
          });
          canvas.insertAt(0, fabricImg);

          // Load bounding boxes
          const boxes: BoundingBox[] = data.annotations?.boundingBoxes || [];
          boxes.forEach(box => {
            // Migrate legacy "defects" label to "crack"
            const label = box.label === 'defects' ? 'crack' : box.label;
            canvas.add(createAnnotationRect({
              left: box.left * scale,
              top: box.top * scale,
              width: box.width * scale,
              height: box.height * scale,
              label,
            }));
          });

          canvas.renderAll();
          setImageLoaded(true);
          setZoom(1);
          updateBoxCount();
          undoStackRef.current = [];
          redoStackRef.current = [];
          setLoading(false);
        };
        img.onerror = () => {
          setError('Failed to load image');
          setLoading(false);
        };
        img.src = data.imageUrl;
      } else {
        setError('No image URL received');
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image');
      setLoading(false);
    }
  }, [orgId, projectId, env, updateBoxCount]);

  // Initialize canvas
  useEffect(() => {
    if (!mounted || !canvasRef.current || fabricCanvasRef.current) return;

    const container = canvasRef.current.parentElement;
    if (!container) return;

    const canvas = new Canvas(canvasRef.current, {
      width: container.clientWidth,
      height: container.clientHeight,
      selection: true,
      backgroundColor: '#1a1a2e',
    });
    fabricCanvasRef.current = canvas;

    // Mouse down - start drawing or panning
    canvas.on('mouse:down', (opt: any) => {
      if (isPanningRef.current) return;
      const evt = opt.e as MouseEvent;

      if (evt.altKey || !isDrawingRef.current) {
        // Pan mode
        isPanningRef.current = true;
        lastPosRef.current = { x: evt.clientX, y: evt.clientY };
        canvas.selection = false;
        return;
      }

      if (!isDrawingRef.current) return;
      if (opt.target && opt.target.type === 'rect') return;

      const pointer = canvas.getScenePoint(opt.e);
      startPointRef.current = { x: pointer.x, y: pointer.y };

      const currentLabel = activeLabelRef.current;
      const rect = createAnnotationRect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        label: currentLabel,
      });
      currentRectRef.current = rect;
      canvas.add(rect);
    });

    // Mouse move - resize rectangle or pan
    canvas.on('mouse:move', (opt: any) => {
      const evt = opt.e as MouseEvent;

      if (isPanningRef.current && lastPosRef.current) {
        const vpt = canvas.viewportTransform!;
        vpt[4] += evt.clientX - lastPosRef.current.x;
        vpt[5] += evt.clientY - lastPosRef.current.y;
        lastPosRef.current = { x: evt.clientX, y: evt.clientY };
        canvas.requestRenderAll();
        return;
      }

      if (!startPointRef.current || !currentRectRef.current) return;

      const pointer = canvas.getScenePoint(opt.e);
      const rect = currentRectRef.current;

      const left = Math.min(startPointRef.current.x, pointer.x);
      const top = Math.min(startPointRef.current.y, pointer.y);
      const width = Math.abs(pointer.x - startPointRef.current.x);
      const height = Math.abs(pointer.y - startPointRef.current.y);

      rect.set({ left, top, width, height });
      canvas.renderAll();
    });

    // Mouse up - finish drawing or panning
    canvas.on('mouse:up', () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        lastPosRef.current = null;
        canvas.selection = true;
        return;
      }

      if (currentRectRef.current) {
        const rect = currentRectRef.current;
        if (rect.width! < 5 || rect.height! < 5) {
          canvas.remove(rect);
        } else {
          saveUndoState();
        }
        currentRectRef.current = null;
        startPointRef.current = null;
        updateBoxCount();
      }
    });

    // Mouse wheel zoom
    canvas.on('mouse:wheel', (opt: any) => {
      const evt = opt.e as WheelEvent;
      evt.preventDefault();
      const delta = evt.deltaY;
      let newZoom = canvas.getZoom() * (delta > 0 ? 0.9 : 1.1);
      newZoom = Math.max(0.1, Math.min(10, newZoom));
      const point = new Point(evt.offsetX, evt.offsetY);
      canvas.zoomToPoint(point, newZoom);
      setZoom(newZoom);
    });

    loadImage(0);

    return () => {
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
  }, [mounted, loadImage, saveUndoState, updateBoxCount]);

  // Keep draw mode ref in sync
  useEffect(() => {
    isDrawingRef.current = isDrawMode && !isPanMode;
  }, [isDrawMode, isPanMode]);

  // Save annotations for current image
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const canvas = fabricCanvasRef.current;
      if (!canvas) throw new Error('Canvas not ready');

      // Get the background image to calculate inverse scale
      const bgImage = canvas.getObjects().find(obj => obj.type === 'image');
      const scale = bgImage ? (bgImage.scaleX || 1) : 1;

      const boxes = canvas.getObjects()
        .filter(obj => obj.type === 'rect')
        .map(obj => ({
          left: Math.round(obj.left! / scale),
          top: Math.round(obj.top! / scale),
          width: Math.round((obj as Rect).width! * (obj.scaleX || 1) / scale),
          height: Math.round((obj as Rect).height! * (obj.scaleY || 1) / scale),
          label: (obj as any).label || DEFAULT_LABEL,
        }));

      const resp = await fetch(
        buildApiUrl(`/el/projects/${orgId}/${projectId}/annotations?env=${env}&imageIndex=${currentIndex}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boundingBoxes: boxes }),
        }
      );
      if (!resp.ok) throw new Error('Failed to save annotations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [orgId, projectId, env, currentIndex]);

  // Navigation
  const goToImage = useCallback(async (index: number) => {
    if (index < 0 || index >= totalImages) return;
    // Auto-save current before navigating
    await handleSave();
    setCurrentIndex(index);
    loadImage(index);
  }, [totalImages, handleSave, loadImage]);

  // Zoom controls
  const handleZoom = useCallback((direction: 'in' | 'out' | 'reset') => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (direction === 'reset') {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      setZoom(1);
    } else {
      const factor = direction === 'in' ? 1.2 : 0.8;
      const newZoom = Math.max(0.1, Math.min(10, canvas.getZoom() * factor));
      const center = canvas.getCenterPoint();
      canvas.zoomToPoint(new Point(center.x, center.y), newZoom);
      setZoom(newZoom);
    }
  }, []);

  // Delete selected
  const handleDelete = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    saveUndoState();
    const active = canvas.getActiveObjects();
    active.forEach(obj => {
      if (obj.type === 'rect') canvas.remove(obj);
    });
    canvas.discardActiveObject();
    canvas.renderAll();
    updateBoxCount();
  }, [saveUndoState, updateBoxCount]);

  // Restore boxes from serialized state (used by undo/redo)
  const restoreBoxes = useCallback((boxes: BoundingBox[]) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.getObjects().filter(obj => obj.type === 'rect').forEach(obj => canvas.remove(obj));
    boxes.forEach(box => canvas.add(createAnnotationRect(box)));
    canvas.renderAll();
    updateBoxCount();
  }, [updateBoxCount]);

  // Undo
  const handleUndo = useCallback(() => {
    if (!fabricCanvasRef.current || undoStackRef.current.length === 0) return;
    const currentState = JSON.stringify(collectBoxes());
    redoStackRef.current.push(currentState);
    const prevState = undoStackRef.current.pop()!;
    restoreBoxes(JSON.parse(prevState));
  }, [collectBoxes, restoreBoxes]);

  // Redo
  const handleRedo = useCallback(() => {
    if (!fabricCanvasRef.current || redoStackRef.current.length === 0) return;
    const currentState = JSON.stringify(collectBoxes());
    undoStackRef.current.push(currentState);
    const nextState = redoStackRef.current.pop()!;
    restoreBoxes(JSON.parse(nextState));
  }, [collectBoxes, restoreBoxes]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToImage(currentIndex - 1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToImage(currentIndex + 1);
      }
      // Label shortcuts: 1 = crack, 2 = micro-crack
      if (e.key === '1') setActiveLabel('crack');
      if (e.key === '2') setActiveLabel('micro-crack');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleUndo, handleRedo, handleDelete, goToImage, currentIndex]);

  if (!mounted) return null;

  const counts = countByLabel();

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {/* Image Navigation */}
          <div className="flex items-center gap-1 mr-4">
            <button
              onClick={() => goToImage(currentIndex - 1)}
              disabled={currentIndex <= 0 || loading}
              className="p-2 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous image (←)"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm text-gray-300 min-w-[100px] text-center">
              {totalImages > 0 ? `${currentIndex + 1} / ${totalImages}` : '...'}
            </span>
            <button
              onClick={() => goToImage(currentIndex + 1)}
              disabled={currentIndex >= totalImages - 1 || loading}
              className="p-2 rounded text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next image (→)"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="h-6 w-px bg-gray-600 mx-1" />

          {/* Mode toggle */}
          <button
            onClick={() => { setIsDrawMode(true); setIsPanMode(false); }}
            className={`p-2 rounded ${isDrawMode && !isPanMode ? 'text-white' : 'text-gray-300 hover:bg-gray-700'}`}
            style={isDrawMode && !isPanMode ? { backgroundColor: labelColor(activeLabel) } : undefined}
            title="Draw box"
          >
            <Square className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setIsDrawMode(false); setIsPanMode(false); }}
            className={`p-2 rounded ${!isDrawMode && !isPanMode ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
            title="Select mode"
          >
            <Pointer className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setIsPanMode(true); setIsDrawMode(false); }}
            className={`p-2 rounded ${isPanMode ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
            title="Pan mode (Alt+drag always pans)"
          >
            <Hand className="h-4 w-4" />
          </button>

          <div className="h-6 w-px bg-gray-600 mx-1" />

          {/* Label selector */}
          {LABELS.map(label => {
            const cfg = LABEL_CONFIG[label];
            const isActive = activeLabel === label;
            return (
              <button
                key={label}
                onClick={() => { setActiveLabel(label); setIsDrawMode(true); setIsPanMode(false); }}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  isActive
                    ? 'text-white border-transparent'
                    : 'text-gray-300 border-gray-600 hover:border-gray-400'
                }`}
                style={isActive ? { backgroundColor: cfg.color } : undefined}
                title={`${cfg.display} (${cfg.key})`}
              >
                {cfg.display}
              </button>
            );
          })}

          <div className="h-6 w-px bg-gray-600 mx-1" />

          {/* Zoom */}
          <button onClick={() => handleZoom('out')} className="p-2 text-gray-300 hover:bg-gray-700 rounded" title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => handleZoom('in')} className="p-2 text-gray-300 hover:bg-gray-700 rounded" title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={() => handleZoom('reset')} className="p-2 text-gray-300 hover:bg-gray-700 rounded" title="Reset view">
            <RotateCcw className="h-4 w-4" />
          </button>

          <div className="h-6 w-px bg-gray-600 mx-1" />

          {/* Edit actions */}
          <button onClick={handleDelete} className="p-2 text-gray-300 hover:bg-gray-700 rounded" title="Delete selected (Del)">
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={handleUndo} className="p-2 text-gray-300 hover:bg-gray-700 rounded" title="Undo (Ctrl+Z)">
            <Undo2 className="h-4 w-4" />
          </button>
          <button onClick={handleRedo} className="p-2 text-gray-300 hover:bg-gray-700 rounded" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Info */}
          <span className="text-xs text-gray-400 truncate max-w-[200px]">
            {currentFilename}
          </span>
          {/* Per-label counts */}
          {LABELS.map(label => {
            const c = counts[label] || 0;
            if (c === 0 && boxCount === 0) return null;
            return (
              <span
                key={label}
                className="text-xs font-medium"
                style={{ color: LABEL_CONFIG[label].color }}
              >
                {c} {LABEL_CONFIG[label].display.toLowerCase()}
              </span>
            );
          })}

          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save (Ctrl+S)
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-900/80">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            <span className="ml-2 text-gray-300">Loading image...</span>
          </div>
        )}
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
