'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, Rect, Image as FabricImage, Point, type TPointerEventInfo } from 'fabric';
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
import { buildApiUrl, apiFetch } from '@/lib/api-client';

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
// Multi-class EL taxonomy. Keep in sync with:
//   - solar-admin-dashboard/serverless/admin-api/functions/el-run-detections/index.js MOCK_LABELS
//   - solar-detection-model/deploy/training_el/prepare_coco.py CATEGORIES
//   - solar-web-app/iac/cdk/lib/solar-stack.ts EL_CLASSES env var
//   - el-report-builder/src/el_report_builder/config/constants.py DEFECT_COLORS
type DefectLabel = 'crack' | 'micro-crack' | 'finger-interruption' | 'dead-cell';

const LABEL_CONFIG: Record<DefectLabel, { color: string; display: string; key: string }> = {
  crack:                 { color: '#ef4444', display: 'Crack',               key: '1' },
  'micro-crack':         { color: '#f59e0b', display: 'Micro-crack',         key: '2' },
  'finger-interruption': { color: '#3b82f6', display: 'Finger interruption', key: '3' },
  'dead-cell':           { color: '#8b5cf6', display: 'Dead cell',           key: '4' },
};

const LABELS = Object.keys(LABEL_CONFIG) as DefectLabel[];
const DEFAULT_LABEL: DefectLabel = 'crack';

/** Fabric.js Rect with an attached label property for defect type */
interface LabeledRect extends Rect {
  label?: string;
}

function labelColor(label: string): string {
  return (LABEL_CONFIG as Record<string, { color: string }>)[label]?.color ?? '#ef4444';
}

function createAnnotationRect(box: { left: number; top: number; width: number; height: number; label: string }): LabeledRect {
  const color = labelColor(box.label);
  const rect: LabeledRect = new Rect({
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
  rect.label = box.label;
  return rect;
}

export function ELAnnotationTool({ orgId, projectId, env }: ELAnnotationToolProps) {
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boxCount, setBoxCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [, setImageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isDrawMode, setIsDrawMode] = useState(true);
  const [activeLabel, setActiveLabel] = useState<DefectLabel>(DEFAULT_LABEL);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Image navigation state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [currentFilename, setCurrentFilename] = useState('');

  // Drawing refs
  const isDrawingRef = useRef(false);
  const isPanModeRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentRectRef = useRef<Rect | null>(null);
  const activeLabelRef = useRef<DefectLabel>(DEFAULT_LABEL);

  // Generation counter — incremented on every loadImage call and on canvas
  // disposal so that stale img.onload callbacks are discarded.
  const loadGenRef = useRef(0);

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
          label: (obj as LabeledRect).label || DEFAULT_LABEL,
        }))
    );
    undoStackRef.current.push(state);
    redoStackRef.current = [];
  }, []);

  // Stable refs so the canvas init effect never re-runs when these change
  const saveUndoStateRef = useRef(saveUndoState);
  useEffect(() => { saveUndoStateRef.current = saveUndoState; }, [saveUndoState]);
  const updateBoxCountRef = useRef(updateBoxCount);
  useEffect(() => { updateBoxCountRef.current = updateBoxCount; }, [updateBoxCount]);

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
        label: (obj as LabeledRect).label || DEFAULT_LABEL,
      }));
  }, []);

  // Count boxes by label
  const countByLabel = useCallback((): Record<string, number> => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return {};
    const counts: Record<string, number> = {};
    canvas.getObjects().filter(obj => obj.type === 'rect').forEach(obj => {
      const lbl = (obj as LabeledRect).label || DEFAULT_LABEL;
      counts[lbl] = (counts[lbl] || 0) + 1;
    });
    return counts;
  }, []);

  // Load image + annotations for a given index.
  // Returns a Promise that resolves when the image has fully loaded (or failed).
  const loadImage = useCallback(async (imageIndex: number) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Bump generation so any in-flight img.onload from a previous call is
    // ignored when it eventually fires.
    const gen = ++loadGenRef.current;

    setLoading(true);
    setError(null);

    try {
      const resp = await apiFetch(
        buildApiUrl(`/el/projects/${orgId}/${projectId}/annotations?env=${env}&imageIndex=${imageIndex}`)
      );
      if (!resp.ok) throw new Error('Failed to load EL image data');
      const data = await resp.json();

      // Stale check: another loadImage call may have started while we awaited
      if (gen !== loadGenRef.current) return;

      setTotalImages(data.totalImages || 0);
      setCurrentIndex(data.currentIndex ?? imageIndex);
      setCurrentFilename(data.filename || `Image ${imageIndex + 1}`);

      // Clear existing objects
      canvas.getObjects().slice().forEach(obj => canvas.remove(obj));

      // Load image onto canvas
      if (data.imageUrl) {
        await new Promise<void>((resolve) => {
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            // Stale / disposed check — if the user navigated away or the
            // canvas was disposed before this image loaded, bail out.
            if (gen !== loadGenRef.current || !fabricCanvasRef.current) {
              resolve();
              return;
            }

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
            updateBoxCountRef.current();
            undoStackRef.current = [];
            redoStackRef.current = [];
            setLoading(false);
            resolve();
          };
          img.onerror = () => {
            if (gen !== loadGenRef.current) {
              resolve();
              return;
            }
            setError('Failed to load image');
            setLoading(false);
            resolve();
          };
          img.src = data.imageUrl;
        });
      } else {
        setError('No image URL received');
        setLoading(false);
      }
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load image');
      setLoading(false);
    }
  }, [orgId, projectId, env]);

  // Stable ref for loadImage so the canvas init effect never re-runs
  const loadImageRef = useRef(loadImage);
  useEffect(() => { loadImageRef.current = loadImage; }, [loadImage]);

  // Initialize canvas — only depends on mounted, never re-runs
  useEffect(() => {
    if (!mounted || !canvasWrapperRef.current || fabricCanvasRef.current) return;

    const container = canvasWrapperRef.current;

    // Create canvas element imperatively so React never manages it.
    // Fabric.js wraps the canvas in its own container div and adds sibling
    // elements — if React tries to reconcile those, it crashes with
    // "insertBefore" errors.
    const canvasEl = document.createElement('canvas');
    container.appendChild(canvasEl);

    const canvas = new Canvas(canvasEl, {
      width: container.clientWidth,
      height: container.clientHeight,
      selection: true,
      backgroundColor: '#1a1a2e',
    });
    fabricCanvasRef.current = canvas;

    // Mouse down - start drawing or panning
    canvas.on('mouse:down', (opt: TPointerEventInfo) => {
      if (isPanningRef.current) return;
      const evt = opt.e as MouseEvent;

      // Alt+drag always pans, regardless of mode
      if (evt.altKey || isPanModeRef.current) {
        isPanningRef.current = true;
        lastPosRef.current = { x: evt.clientX, y: evt.clientY };
        canvas.selection = false;
        return;
      }

      // Select mode: let Fabric.js handle selection naturally (no custom code needed)
      if (!isDrawingRef.current) return;

      // Draw mode: don't draw on top of existing annotations
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
    canvas.on('mouse:move', (opt: TPointerEventInfo) => {
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
          saveUndoStateRef.current();
        }
        currentRectRef.current = null;
        startPointRef.current = null;
        updateBoxCountRef.current();
      }
    });

    // Mouse wheel zoom
    canvas.on('mouse:wheel', (opt: TPointerEventInfo<WheelEvent>) => {
      const evt = opt.e as WheelEvent;
      evt.preventDefault();
      const delta = evt.deltaY;
      let newZoom = canvas.getZoom() * (delta > 0 ? 0.9 : 1.1);
      newZoom = Math.max(0.1, Math.min(10, newZoom));
      const point = new Point(evt.offsetX, evt.offsetY);
      canvas.zoomToPoint(point, newZoom);
      setZoom(newZoom);
    });

    // Load first image
    loadImageRef.current(0);

    return () => {
      // Invalidate any pending img.onload callbacks before disposing
      loadGenRef.current++;
      canvas.dispose();
      fabricCanvasRef.current = null;
      // Remove all imperatively created DOM nodes from the wrapper
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Keep mode refs in sync and configure canvas selection/selectability
  useEffect(() => {
    isDrawingRef.current = isDrawMode && !isPanMode;
    isPanModeRef.current = isPanMode;

    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // In Select mode: enable canvas selection (drag to multi-select) and make rects selectable
    // In Draw mode: disable selection so drawing works freely
    // In Pan mode: disable selection
    const isSelectMode = !isDrawMode && !isPanMode;
    canvas.selection = isSelectMode;

    canvas.getObjects().forEach(obj => {
      if (obj.type === 'rect') {
        obj.selectable = isSelectMode;
        obj.evented = !isPanMode;
      }
    });
    canvas.renderAll();
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
          label: (obj as LabeledRect).label || DEFAULT_LABEL,
        }));

      const resp = await apiFetch(
        buildApiUrl(`/el/projects/${orgId}/${projectId}/annotations?env=${env}&imageIndex=${currentIndex}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boundingBoxes: boxes }),
        }
      );
      if (!resp.ok) throw new Error('Failed to save annotations');
      setSaveMessage({ type: 'success', text: `Saved ${boxes.length} annotation${boxes.length !== 1 ? 's' : ''} successfully` });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      setSaveMessage({ type: 'error', text: msg });
      setTimeout(() => setSaveMessage(null), 5000);
    } finally {
      setSaving(false);
    }
  }, [orgId, projectId, env, currentIndex]);

  // Navigation — awaits full image load before releasing the guard
  const navigatingRef = useRef(false);
  const goToImage = useCallback(async (index: number) => {
    if (index < 0 || index >= totalImages) return;
    if (navigatingRef.current) return; // prevent double-click race
    navigatingRef.current = true;
    try {
      // Auto-save current before navigating
      await handleSave();
      setCurrentIndex(index);
      await loadImage(index);
    } finally {
      navigatingRef.current = false;
    }
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
      // Tool shortcuts
      if (e.key === 'p' || e.key === 'P') {
        setIsPanMode(true);
        setIsDrawMode(false);
      }
      if (e.key === 'b' || e.key === 'B') {
        setIsDrawMode(true);
        setIsPanMode(false);
      }
      if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey && !e.metaKey) {
          setIsDrawMode(false);
          setIsPanMode(false);
        }
      }
      // Label shortcuts: 1 = crack, 2 = micro-crack, 3 = finger-interruption, 4 = dead-cell
      if (e.key === '1') setActiveLabel('crack');
      if (e.key === '2') setActiveLabel('micro-crack');
      if (e.key === '3') setActiveLabel('finger-interruption');
      if (e.key === '4') setActiveLabel('dead-cell');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleUndo, handleRedo, handleDelete, goToImage, currentIndex]);

  // Fix 2: Render a loading placeholder instead of null to avoid tree swap
  if (!mounted) {
    return (
      <div className="flex flex-col h-full bg-gray-900">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

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
            {totalImages > 0 ? (
              <select
                value={currentIndex}
                onChange={(e) => goToImage(Number(e.target.value))}
                disabled={loading}
                className="bg-gray-700 text-gray-300 text-sm border border-gray-600 rounded px-2 py-1 min-w-[120px] text-center focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                {Array.from({ length: totalImages }, (_, i) => (
                  <option key={i} value={i}>
                    Image {i + 1} / {totalImages}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-gray-300 min-w-[100px] text-center">...</span>
            )}
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
            title="Draw box (B)"
          >
            <Square className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setIsDrawMode(false); setIsPanMode(false); }}
            className={`p-2 rounded ${!isDrawMode && !isPanMode ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
            title="Select mode (S)"
          >
            <Pointer className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setIsPanMode(true); setIsDrawMode(false); }}
            className={`p-2 rounded ${isPanMode ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
            title="Pan mode (P) — Alt+drag always pans"
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
          {/* Per-label counts — always rendered, hidden via CSS to keep DOM stable */}
          {LABELS.map(label => {
            const c = counts[label] || 0;
            const visible = c > 0 || boxCount > 0;
            return (
              <span
                key={label}
                className={`text-xs font-medium ${visible ? '' : 'hidden'}`}
                style={{ color: LABEL_CONFIG[label].color }}
              >
                {c} {LABEL_CONFIG[label].display.toLowerCase()}
              </span>
            );
          })}

          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
          {saveMessage && (
            <span className={`text-xs font-medium ${saveMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {saveMessage.text}
            </span>
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

      {/* Canvas — the loading overlay is always rendered (visibility toggled
          via CSS) so React never inserts/removes DOM siblings next to the
          <canvas>, which Fabric.js wraps in its own container. */}
      <div className="flex-1 relative overflow-hidden">
        <div
          className={`absolute inset-0 flex items-center justify-center z-10 bg-gray-900/80 transition-opacity duration-150 ${
            loading ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-300">Loading image...</span>
        </div>
        <div ref={canvasWrapperRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
