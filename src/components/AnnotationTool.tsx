'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, Rect, Image as FabricImage, TPointerEventInfo, TPointerEvent, FabricObject, Point, ActiveSelection } from 'fabric';
import {
  Save,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Square,
  Trash2,
  Tag,
  Hand,
  Pointer,
  Grid3X3,
  MousePointer,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  PenTool,
  Copy,
  Clipboard,
} from 'lucide-react';
import { buildApiUrl } from '@/lib/api-client';

interface AnnotationToolProps {
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

const LABELS = [
  { id: 'default_panel', name: 'Default Panel', color: '#22c55e' },
  { id: 'hotspots', name: 'Hotspots', color: '#ef4444' },
  { id: 'faultydiodes', name: 'Faulty Diodes', color: '#f97316' },
  { id: 'offlinepanels', name: 'Offline Panels', color: '#eab308' },
];

// Extend Rect to include custom label property
interface AnnotatedRect extends Rect {
  label?: string;
}

type SavedBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  label?: string;
};

export function AnnotationTool({ orgId, projectId, env }: AnnotationToolProps) {
  console.log('AnnotationTool component loaded with:', { orgId, projectId, env });
  const [mounted, setMounted] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('default_panel');
  const [boxCount, setBoxCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isDrawMode, setIsDrawMode] = useState(true); // New: separate draw mode from select
  const [aligning, setAligning] = useState(false);
  const [isClickToPlace, setIsClickToPlace] = useState(false);
  const [medianPanelSize, setMedianPanelSize] = useState<{width: number, height: number} | null>(null);
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<SavedBox[]>([]); // For copy/paste
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentRectRef = useRef<Rect | null>(null);

  // Undo/Redo history
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);

  // Helper to save state to undo stack (inline function for use in effects)
  const saveUndoState = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const state = JSON.stringify(
      canvas.getObjects()
        .filter(obj => obj.type === 'rect')
        .map(obj => {
          const rect = obj as AnnotatedRect;
          return {
            left: obj.left,
            top: obj.top,
            width: obj.width,
            height: obj.height,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            label: rect.label,
          };
        })
    );
    undoStackRef.current.push(state);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  };

  // Ensure component only renders on client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!mounted || !canvasRef.current || typeof window === 'undefined') {
      console.log('Canvas initialization check:', { mounted, hasCanvasRef: !!canvasRef.current, hasWindow: typeof window !== 'undefined' });
      return;
    }

    console.log('Initializing Fabric canvas...');
    const canvas = new Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight - 120,
      backgroundColor: '#1f2937',
      selection: true,
    });

    fabricCanvasRef.current = canvas;
    console.log('Canvas initialized, setting canvasReady to true');
    setCanvasReady(true);

    // Handle window resize
    const handleResize = () => {
      canvas.setDimensions({
        width: window.innerWidth,
        height: window.innerHeight - 120,
      });
      canvas.renderAll();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
    };
  }, [mounted]);

  // Load image and annotations
  useEffect(() => {
    console.log('Load data useEffect triggered, canvasReady:', canvasReady, 'fabricCanvasRef.current:', !!fabricCanvasRef.current);
    if (!canvasReady || !fabricCanvasRef.current) {
      console.log('Canvas not ready yet, returning');
      return;
    }

    async function loadData() {
      try {
        // Get image URL and annotations from API
        const apiUrl = buildApiUrl(`/projects/${orgId}/${projectId}/annotations?env=${env}`);
        console.log('Fetching annotations from:', apiUrl);

        const response = await fetch(apiUrl);
        console.log('Response status:', response.status);

        if (!response.ok) throw new Error('Failed to load data');

        const { imageUrl, annotations } = await response.json();
        console.log('Received annotations:', annotations.length, 'Image URL:', imageUrl);

        // Load image
        console.log('Loading image from:', imageUrl);
        const img = await FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' });
        console.log('Image loaded successfully, dimensions:', img.width, 'x', img.height);

        const canvas = fabricCanvasRef.current!;

        // Center and scale image to fit
        const scale = Math.min(
          (canvas.width! - 100) / img.width!,
          (canvas.height! - 100) / img.height!
        );
        console.log('Image scale:', scale);

        img.set({
          left: 50,
          top: 50,
          scaleX: scale,
          scaleY: scale,
          selectable: false,
          evented: false,
        });

        canvas.add(img);
        canvas.sendObjectToBack(img);

        // Load existing annotations
        if (annotations && annotations.length > 0) {
          const boxes = annotations[0]?.boundingBox?.boundingBoxes || [];
          console.log('Loading', boxes.length, 'bounding boxes');
          boxes.forEach((box: BoundingBox) => {
            // Normalize label: solarpanels → default_panel for consistency
            const normalizedLabel = box.label === 'solarpanels' ? 'default_panel' : box.label;
            const labelConfig = LABELS.find((l) => l.id === normalizedLabel);
            const rect = new Rect({
              left: 50 + box.left * scale,
              top: 50 + box.top * scale,
              width: box.width * scale,
              height: box.height * scale,
              fill: 'transparent',
              stroke: labelConfig?.color || '#22c55e',
              strokeWidth: 0.25,
              cornerColor: labelConfig?.color || '#22c55e',
              cornerSize: 2,
              transparentCorners: false,
            }) as AnnotatedRect;
            rect.label = normalizedLabel;
            canvas.add(rect);
          });
          setBoxCount(boxes.length);
          console.log('Added', boxes.length, 'boxes to canvas');
        }

        setImageLoaded(true);
        canvas.renderAll();
        console.log('Canvas rendered, loading complete');
      } catch (err) {
        console.error('Error loading annotations:', err);
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [canvasReady, orgId, projectId, env]);

  // Zoom handler
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !imageLoaded) return;

    const handleWheel = (opt: { e: WheelEvent & { offsetX: number; offsetY: number; deltaY: number } }) => {
      const evt = opt.e;
      evt.preventDefault();
      evt.stopPropagation();

      const delta = evt.deltaY;
      let newZoom = canvas.getZoom();
      newZoom *= 0.999 ** delta;

      // Limit zoom between 0.1x and 100x (10,000%)
      if (newZoom > 100) newZoom = 100;
      if (newZoom < 0.1) newZoom = 0.1;

      canvas.zoomToPoint(new Point(evt.offsetX, evt.offsetY), newZoom);
      setZoom(newZoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    };

    canvas.on('mouse:wheel', handleWheel);

    return () => {
      canvas.off('mouse:wheel', handleWheel);
    };
  }, [imageLoaded]);

  // Drawing and panning handlers
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !imageLoaded) return;

    const handleMouseDown = (e: TPointerEventInfo<TPointerEvent>) => {
      if (!e.pointer) return;

      if (isPanMode) {
        // Pan mode - start panning
        isPanningRef.current = true;
        canvas.selection = false;
        const clientX = 'clientX' in e.e ? e.e.clientX : (e.e as TouchEvent).touches[0].clientX;
        const clientY = 'clientY' in e.e ? e.e.clientY : (e.e as TouchEvent).touches[0].clientY;
        lastPosRef.current = { x: clientX, y: clientY };
      } else if (isClickToPlace && medianPanelSize) {
        // Click to Place mode - place a fixed-size panel at click point
        if (canvas.getActiveObject()) return;

        saveUndoState(); // Save state before adding
        const pointer = canvas.getScenePoint(e.e);
        const labelConfig = LABELS.find((l) => l.id === 'default_panel');

        const rect = new Rect({
          left: pointer.x - medianPanelSize.width / 2,
          top: pointer.y - medianPanelSize.height / 2,
          width: medianPanelSize.width,
          height: medianPanelSize.height,
          fill: 'transparent',
          stroke: labelConfig?.color || '#22c55e',
          strokeWidth: 0.25,
          cornerColor: labelConfig?.color || '#22c55e',
          cornerSize: 2,
          transparentCorners: false,
        }) as AnnotatedRect;
        rect.label = 'default_panel';

        canvas.add(rect);
        setBoxCount((prev) => prev + 1);
        canvas.renderAll();
      } else if (isDrawMode) {
        // Draw mode - ONLY draw new boxes, don't select existing ones
        // Check if clicking on an existing rect - if so, don't start drawing
        const target = canvas.findTarget(e.e);
        if (target && target.type === 'rect') return;

        saveUndoState(); // Save state before drawing
        isDrawingRef.current = true;
        const pointer = canvas.getScenePoint(e.e);
        startPointRef.current = { x: pointer.x, y: pointer.y };

        const labelConfig = LABELS.find((l) => l.id === selectedLabel);
        const rect = new Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'rgba(255,255,255,0.1)',
          stroke: labelConfig?.color || '#22c55e',
          strokeWidth: 0.25,
          cornerColor: labelConfig?.color || '#22c55e',
          cornerSize: 2,
          transparentCorners: false,
          selectable: false, // Not selectable while drawing
        }) as AnnotatedRect;
        rect.label = selectedLabel;

        currentRectRef.current = rect;
        canvas.add(rect);
      }
      // Select mode: let Fabric.js handle selection naturally (no custom code needed)
    };

    const handleMouseMove = (e: TPointerEventInfo<TPointerEvent>) => {
      if (isPanningRef.current && lastPosRef.current) {
        // Pan the canvas
        const clientX = 'clientX' in e.e ? e.e.clientX : (e.e as TouchEvent).touches[0].clientX;
        const clientY = 'clientY' in e.e ? e.e.clientY : (e.e as TouchEvent).touches[0].clientY;
        const vpt = canvas.viewportTransform!;
        vpt[4] += clientX - lastPosRef.current.x;
        vpt[5] += clientY - lastPosRef.current.y;
        canvas.requestRenderAll();
        lastPosRef.current = { x: clientX, y: clientY };
        return;
      }

      if (!isDrawingRef.current || !startPointRef.current || !currentRectRef.current)
        return;

      const pointer = canvas.getScenePoint(e.e);
      const rect = currentRectRef.current;

      const width = pointer.x - startPointRef.current.x;
      const height = pointer.y - startPointRef.current.y;

      rect.set({
        width: Math.abs(width),
        height: Math.abs(height),
        left: width < 0 ? pointer.x : startPointRef.current.x,
        top: height < 0 ? pointer.y : startPointRef.current.y,
      });

      canvas.renderAll();
    };

    const handleMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        lastPosRef.current = null;
        canvas.selection = true;
        return;
      }

      if (!isDrawingRef.current || !currentRectRef.current) return;

      isDrawingRef.current = false;
      const rect = currentRectRef.current;

      // Remove if too small (allow 1x1 pixel annotations for tiny hotspots)
      if (rect.width! < 1 || rect.height! < 1) {
        canvas.remove(rect);
      } else {
        rect.set('fill', 'transparent');
        setBoxCount((prev) => prev + 1);
      }

      currentRectRef.current = null;
      startPointRef.current = null;
      canvas.renderAll();
    };

    // Configure canvas selection based on mode
    // In Draw mode: disable selection so we can draw freely
    // In Select mode: enable selection
    canvas.selection = !isDrawMode && !isPanMode && !isClickToPlace;

    // Make all rects selectable or not based on mode
    canvas.getObjects().forEach((obj) => {
      if (obj.type === 'rect') {
        obj.selectable = !isDrawMode && !isPanMode && !isClickToPlace;
        obj.evented = !isPanMode;
      }
    });

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
    };
  }, [imageLoaded, selectedLabel, isPanMode, isDrawMode, isClickToPlace, medianPanelSize]);

  const handleSave = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    setSaving(true);
    try {
      // Get the background image to calculate scale
      const bgImage = canvas.getObjects().find((obj) => obj.type === 'image');
      if (!bgImage) throw new Error('No image loaded');

      const scale = (bgImage as FabricImage).scaleX || 1;
      const offsetX = bgImage.left || 50;
      const offsetY = bgImage.top || 50;

      // Extract bounding boxes
      const boxes: BoundingBox[] = [];
      canvas.getObjects().forEach((obj) => {
        const annotatedRect = obj as AnnotatedRect;
        if (obj.type === 'rect' && annotatedRect.label) {
          boxes.push({
            left: Math.round((obj.left! - offsetX) / scale),
            top: Math.round((obj.top! - offsetY) / scale),
            width: Math.round(obj.width! * (obj.scaleX || 1) / scale),
            height: Math.round(obj.height! * (obj.scaleY || 1) / scale),
            label: annotatedRect.label,
          });
        }
      });

      // Save to S3
      const response = await fetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/annotations?env=${env}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boundingBoxes: boxes }),
        }
      );

      if (!response.ok) throw new Error('Failed to save');

      setBoxCount(boxes.length);
      alert(`Saved ${boxes.length} annotations successfully!`);
    } catch (err) {
      alert('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  }, [env, orgId, projectId]);

  // Save current canvas state to undo stack
  const saveToUndoStack = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const state = JSON.stringify(
      canvas.getObjects()
        .filter(obj => obj.type === 'rect')
        .map(obj => {
          const rect = obj as AnnotatedRect;
          return {
            left: obj.left,
            top: obj.top,
            width: obj.width,
            height: obj.height,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            label: rect.label,
          };
        })
    );
    undoStackRef.current.push(state);
    // Limit stack size
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    // Clear redo stack when new action is performed
    redoStackRef.current = [];
  }, []);

  // Undo last action
  const handleUndo = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || undoStackRef.current.length === 0) return;

    // Save current state to redo stack
    const currentState = JSON.stringify(
      canvas.getObjects()
        .filter(obj => obj.type === 'rect')
        .map(obj => {
          const rect = obj as AnnotatedRect;
          return {
            left: obj.left,
            top: obj.top,
            width: obj.width,
            height: obj.height,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            label: rect.label,
          };
        })
    );
    redoStackRef.current.push(currentState);

    // Restore previous state
    const previousState = undoStackRef.current.pop();
    if (!previousState) return;

    const boxes = JSON.parse(previousState) as SavedBox[];

    // Remove all rects
    const rectsToRemove = canvas.getObjects().filter(obj => obj.type === 'rect');
    rectsToRemove.forEach(obj => canvas.remove(obj));

    // Restore boxes
    boxes.forEach((box) => {
      const labelConfig = LABELS.find((l) => l.id === box.label);
      const rect = new Rect({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        scaleX: box.scaleX || 1,
        scaleY: box.scaleY || 1,
        fill: 'transparent',
        stroke: labelConfig?.color || '#22c55e',
        strokeWidth: 0.25,
        cornerColor: labelConfig?.color || '#22c55e',
        cornerSize: 2,
        transparentCorners: false,
      }) as AnnotatedRect;
      rect.label = box.label;
      canvas.add(rect);
    });

    setBoxCount(boxes.length);
    canvas.renderAll();
  }, []);

  // Redo last undone action
  const handleRedo = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || redoStackRef.current.length === 0) return;

    // Save current state to undo stack
    const currentState = JSON.stringify(
      canvas.getObjects()
        .filter(obj => obj.type === 'rect')
        .map(obj => {
          const rect = obj as AnnotatedRect;
          return {
            left: obj.left,
            top: obj.top,
            width: obj.width,
            height: obj.height,
            scaleX: obj.scaleX,
            scaleY: obj.scaleY,
            label: rect.label,
          };
        })
    );
    undoStackRef.current.push(currentState);

    // Restore redo state
    const redoState = redoStackRef.current.pop();
    if (!redoState) return;

    const boxes = JSON.parse(redoState) as SavedBox[];

    // Remove all rects
    const rectsToRemove = canvas.getObjects().filter(obj => obj.type === 'rect');
    rectsToRemove.forEach(obj => canvas.remove(obj));

    // Restore boxes
    boxes.forEach((box) => {
      const labelConfig = LABELS.find((l) => l.id === box.label);
      const rect = new Rect({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        scaleX: box.scaleX || 1,
        scaleY: box.scaleY || 1,
        fill: 'transparent',
        stroke: labelConfig?.color || '#22c55e',
        strokeWidth: 0.25,
        cornerColor: labelConfig?.color || '#22c55e',
        cornerSize: 2,
        transparentCorners: false,
      }) as AnnotatedRect;
      rect.label = box.label;
      canvas.add(rect);
    });

    setBoxCount(boxes.length);
    canvas.renderAll();
  }, []);

  // Copy selected annotations to clipboard
  const handleCopy = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const activeObject = canvas.getActiveObject();
    if (!activeObject) return;

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    const copiedBoxes: SavedBox[] = [];

    // Check if we have an ActiveSelection (multiple objects selected)
    const isMultiSelect = activeObject.type === 'activeselection' || activeObject.type === 'activeSelection';

    activeObjects.forEach((obj) => {
      if (obj.type === 'rect') {
        const rect = obj as AnnotatedRect;

        // When objects are in an ActiveSelection, their coordinates are relative to the group
        // We need to calculate absolute canvas coordinates
        let absLeft = obj.left!;
        let absTop = obj.top!;

        if (isMultiSelect) {
          // Get the selection's center position and calculate absolute coords
          const selectionLeft = activeObject.left! + (activeObject.width! * (activeObject.scaleX || 1)) / 2;
          const selectionTop = activeObject.top! + (activeObject.height! * (activeObject.scaleY || 1)) / 2;
          absLeft = selectionLeft + obj.left!;
          absTop = selectionTop + obj.top!;
        }

        copiedBoxes.push({
          left: absLeft,
          top: absTop,
          width: obj.width!,
          height: obj.height!,
          scaleX: obj.scaleX || 1,
          scaleY: obj.scaleY || 1,
          label: rect.label,
        });
      }
    });

    if (copiedBoxes.length > 0) {
      setClipboard(copiedBoxes);
    }
  }, []);

  // Paste annotations from clipboard
  const handlePaste = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || clipboard.length === 0) return;

    saveUndoState();

    // Paste with a small offset (20px in canvas space) so user can see the new boxes
    // The offset is applied to the original positions, placing them slightly to the right and down
    const offset = 20;

    const newRects: Rect[] = [];
    clipboard.forEach((box) => {
      const labelConfig = LABELS.find((l) => l.id === box.label);
      const rect = new Rect({
        left: box.left + offset,
        top: box.top + offset,
        width: box.width,
        height: box.height,
        scaleX: box.scaleX || 1,
        scaleY: box.scaleY || 1,
        fill: 'transparent',
        stroke: labelConfig?.color || '#22c55e',
        strokeWidth: 0.25,
        cornerColor: labelConfig?.color || '#22c55e',
        cornerSize: 2,
        transparentCorners: false,
        selectable: !isDrawMode && !isPanMode && !isClickToPlace,
      }) as AnnotatedRect;
      rect.label = box.label;
      canvas.add(rect);
      newRects.push(rect);
    });

    // Select the newly pasted objects so user can immediately move them
    if (!isDrawMode && !isPanMode && !isClickToPlace) {
      if (newRects.length === 1) {
        canvas.setActiveObject(newRects[0]);
      } else if (newRects.length > 1) {
        // For multiple objects, create an ActiveSelection
        canvas.discardActiveObject();
        const sel = new ActiveSelection(newRects, { canvas });
        canvas.setActiveObject(sel);
      }
    }

    setBoxCount((prev) => prev + clipboard.length);
    canvas.renderAll();
  }, [clipboard, isDrawMode, isPanMode, isClickToPlace]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        handleRedo();
        return;
      }
      // Copy: Ctrl+C
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      // Paste: Ctrl+V
      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        handlePaste();
        return;
      }
      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          saveToUndoStack();
          activeObjects.forEach((obj) => {
            if (obj.type === 'rect') {
              canvas.remove(obj);
            }
          });
          canvas.discardActiveObject();
          setBoxCount((prev) => prev - activeObjects.filter(o => o.type === 'rect').length);
          canvas.renderAll();
        }
      }
      // Number keys for label selection
      if (e.key >= '1' && e.key <= '4') {
        const index = parseInt(e.key) - 1;
        if (LABELS[index]) {
          setSelectedLabel(LABELS[index].id);
        }
      }
      // Mode shortcuts: B = Box/Draw, S = Select, P = Pan, C = Click-to-place
      if (e.key === 'b' && !e.ctrlKey) {
        // Box/Draw mode
        setIsDrawMode(true);
        setIsPanMode(false);
        setIsClickToPlace(false);
      }
      if (e.key === 's' && !e.ctrlKey) {
        // Select mode (no drawing)
        setIsDrawMode(false);
        setIsPanMode(false);
        setIsClickToPlace(false);
      }
      if (e.key === 'p' && !e.ctrlKey) {
        // Pan mode
        setIsPanMode(true);
        setIsDrawMode(false);
        setIsClickToPlace(false);
      }
      if (e.key === 'c' && !e.ctrlKey) {
        // Click-to-place mode
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const panels = canvas.getObjects().filter(obj => {
          const rect = obj as AnnotatedRect;
          return obj.type === 'rect' &&
            (rect.label === 'default_panel' || rect.label === 'solarpanels');
        });
        if (panels.length < 1) {
          alert('No existing panels found to calculate size from');
          return;
        }
        const widths = panels.map(p => p.width! * (p.scaleX || 1));
        const heights = panels.map(p => p.height! * (p.scaleY || 1));
        widths.sort((a, b) => a - b);
        heights.sort((a, b) => a - b);
        setMedianPanelSize({
          width: widths[Math.floor(widths.length / 2)],
          height: heights[Math.floor(heights.length / 2)],
        });
        setIsClickToPlace(true);
        setIsDrawMode(false);
        setIsPanMode(false);
      }
      // Ctrl+S to save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleUndo, handleRedo, handleCopy, handlePaste, saveToUndoStack]);

  const handleZoom = (delta: number) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const newZoom = Math.max(0.1, Math.min(100, zoom + delta));
    setZoom(newZoom);

    const center = canvas.getCenterPoint();
    canvas.zoomToPoint(center, newZoom);
    canvas.renderAll();
  };

  const handleReset = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
  };

  const handleDeleteSelected = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const active = canvas.getActiveObject();
    if (active && active.type === 'rect') {
      saveUndoState();
      canvas.remove(active);
      setBoxCount((prev) => prev - 1);
      canvas.renderAll();
    }
  };

  const handleChangeLabel = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const active = canvas.getActiveObject();
    if (active && active.type === 'rect') {
      saveUndoState();
      const labelConfig = LABELS.find((l) => l.id === selectedLabel);
      const annotatedRect = active as AnnotatedRect;
      annotatedRect.label = selectedLabel;
      active.set({
        stroke: labelConfig?.color || '#22c55e',
        cornerColor: labelConfig?.color || '#22c55e',
      });
      canvas.renderAll();
    }
  };

  // Toggle visibility of a label class
  const toggleLabelVisibility = (labelId: string) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const newHidden = new Set(hiddenLabels);
    const isCurrentlyHidden = newHidden.has(labelId);

    if (isCurrentlyHidden) {
      newHidden.delete(labelId);
    } else {
      newHidden.add(labelId);
    }
    setHiddenLabels(newHidden);

    // Update visibility of all rects with this label
    canvas.getObjects().forEach((obj) => {
      const rect = obj as AnnotatedRect;
      if (obj.type === 'rect') {
        // Check both the label and solarpanels (which maps to default_panel)
        const effectiveLabel = rect.label === 'solarpanels' ? 'default_panel' : rect.label;
        if (effectiveLabel === labelId) {
          obj.set('visible', isCurrentlyHidden); // Toggle: was hidden, now visible
        }
      }
    });
    canvas.renderAll();
  };

  const handleAlignPanels = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    saveUndoState(); // Save state before alignment
    setAligning(true);
    try {
      // Get the background image for scale calculation
      const bgImage = canvas.getObjects().find((obj) => obj.type === 'image');
      if (!bgImage) throw new Error('No image loaded');

      const scale = (bgImage as FabricImage).scaleX || 1;
      const offsetX = bgImage.left || 50;
      const offsetY = bgImage.top || 50;

      // Extract only panel boxes (in image coordinates)
      // Check both 'default_panel' and 'solarpanels' labels for compatibility
      const panelBoxes: BoundingBox[] = [];
      let defectCount = 0;

      canvas.getObjects().forEach((obj) => {
        const annotatedRect = obj as AnnotatedRect;
        const isPanel = obj.type === 'rect' &&
          (annotatedRect.label === 'default_panel' || annotatedRect.label === 'solarpanels');
        if (isPanel) {
          panelBoxes.push({
            left: Math.round((obj.left! - offsetX) / scale),
            top: Math.round((obj.top! - offsetY) / scale),
            width: Math.round(obj.width! * (obj.scaleX || 1) / scale),
            height: Math.round(obj.height! * (obj.scaleY || 1) / scale),
            label: 'default_panel',
          });
        } else if (obj.type === 'rect' && annotatedRect.label) {
          defectCount++;
        }
      });

      if (panelBoxes.length < 3) {
        alert('Need at least 3 panels to align');
        return;
      }

      // Call alignment API
      const response = await fetch(
        buildApiUrl(`/projects/${orgId}/${projectId}/align-panels?env=${env}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boundingBoxes: panelBoxes }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alignment failed: ${errorText}`);
      }
      const { aligned_boxes } = await response.json();

      // Remove old panel rects (keep defects)
      const objectsToRemove: FabricObject[] = [];
      canvas.getObjects().forEach((obj) => {
        const annotatedRect = obj as AnnotatedRect;
        const isPanel = obj.type === 'rect' &&
          (annotatedRect.label === 'default_panel' || annotatedRect.label === 'solarpanels');
        if (isPanel) {
          objectsToRemove.push(obj);
        }
      });
      objectsToRemove.forEach((obj) => canvas.remove(obj));

      // Add aligned panel rects
      const labelConfig = LABELS.find((l) => l.id === 'default_panel');
      aligned_boxes.forEach((box: BoundingBox) => {
        const rect = new Rect({
          left: offsetX + box.left * scale,
          top: offsetY + box.top * scale,
          width: box.width * scale,
          height: box.height * scale,
          fill: 'transparent',
          stroke: labelConfig?.color || '#22c55e',
          strokeWidth: 0.25,
          cornerColor: labelConfig?.color || '#22c55e',
          cornerSize: 2,
          transparentCorners: false,
        }) as AnnotatedRect;
        rect.label = 'default_panel';
        canvas.add(rect);
      });

      setBoxCount(aligned_boxes.length + defectCount);
      canvas.renderAll();
      alert(`Aligned ${aligned_boxes.length} panels!`);
    } catch (err) {
      alert('Alignment failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setAligning(false);
    }
  }, [env, orgId, projectId]);

  const enterClickToPlaceMode = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Get panel dimensions from existing panels (check both labels for compatibility)
    const panels = canvas.getObjects().filter(obj => {
      const rect = obj as AnnotatedRect;
      return obj.type === 'rect' &&
        (rect.label === 'default_panel' || rect.label === 'solarpanels');
    });

    if (panels.length < 1) {
      alert('No existing panels found to calculate size from');
      return;
    }

    const widths = panels.map(p => p.width! * (p.scaleX || 1));
    const heights = panels.map(p => p.height! * (p.scaleY || 1));

    // Sort and get median
    widths.sort((a, b) => a - b);
    heights.sort((a, b) => a - b);

    setMedianPanelSize({
      width: widths[Math.floor(widths.length / 2)],
      height: heights[Math.floor(heights.length / 2)],
    });
    setIsClickToPlace(true);
    setIsPanMode(false);
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-300">Initializing...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-red-900 text-red-100 p-4 rounded-lg">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Toolbar */}
      <div className="absolute top-4 left-4 z-10 bg-gray-800 rounded-lg p-3 shadow-lg">
        <div className="space-y-3">
          {/* Label selector */}
          <div>
            <div className="text-xs text-gray-400 mb-2">Label (1-4)</div>
            <div className="space-y-1">
              {LABELS.map((label, index) => (
                <div key={label.id} className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedLabel(label.id)}
                    className={`flex-1 flex items-center gap-2 px-2 py-1 rounded text-xs ${
                      selectedLabel === label.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <div
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: label.color }}
                    />
                    <span>{index + 1}. {label.name}</span>
                  </button>
                  <button
                    onClick={() => toggleLabelVisibility(label.id)}
                    className={`p-1 rounded text-xs ${
                      hiddenLabels.has(label.id)
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title={hiddenLabels.has(label.id) ? 'Show' : 'Hide'}
                  >
                    {hiddenLabels.has(label.id) ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-400 mb-2">Mode (B/S/P/C)</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setIsDrawMode(true); setIsPanMode(false); setIsClickToPlace(false); }}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${
                  isDrawMode && !isPanMode && !isClickToPlace
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="Draw bounding boxes (B)"
              >
                <PenTool className="h-3 w-3" />
                Box
              </button>
              <button
                onClick={() => { setIsDrawMode(false); setIsPanMode(false); setIsClickToPlace(false); }}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${
                  !isDrawMode && !isPanMode && !isClickToPlace
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="Select annotations (S)"
              >
                <Pointer className="h-3 w-3" />
                Select
              </button>
              <button
                onClick={() => { setIsPanMode(true); setIsDrawMode(false); setIsClickToPlace(false); }}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${
                  isPanMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="Pan/navigate (P)"
              >
                <Hand className="h-3 w-3" />
                Pan
              </button>
              <button
                onClick={() => isClickToPlace ? setIsClickToPlace(false) : enterClickToPlaceMode()}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${
                  isClickToPlace
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="Click to place panels (C)"
              >
                <MousePointer className="h-3 w-3" />
                Click
              </button>
            </div>
          </div>

          {/* Undo/Redo */}
          <div className="border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-400 mb-2">History</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleUndo}
                className="flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
              <button
                onClick={handleRedo}
                className="flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="h-3 w-3" />
                Redo
              </button>
            </div>
          </div>

          {/* Copy/Paste */}
          <div className="border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-400 mb-2">Clipboard {clipboard.length > 0 && `(${clipboard.length})`}</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600"
                title="Copy selected (Ctrl+C)"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
              <button
                onClick={handlePaste}
                disabled={clipboard.length === 0}
                className="flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Paste (Ctrl+V)"
              >
                <Clipboard className="h-3 w-3" />
                Paste
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-400 mb-2">Actions</div>
            <div className="space-y-2">
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-2 w-full px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
              >
                <Trash2 className="h-3 w-3" />
                Delete (Del)
              </button>
              <button
                onClick={handleChangeLabel}
                className="flex items-center gap-2 w-full px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700"
              >
                <Tag className="h-3 w-3" />
                Apply Label
              </button>
              <button
                onClick={handleAlignPanels}
                disabled={aligning}
                className="flex items-center gap-2 w-full px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:opacity-50"
              >
                {aligning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Grid3X3 className="h-3 w-3" />}
                Align Panels
              </button>
            </div>
          </div>

          {/* Zoom */}
          <div className="border-t border-gray-700 pt-3">
            <div className="text-xs text-gray-400 mb-2">
              Zoom: {Math.round(zoom * 100)}%
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleZoom(0.2)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleZoom(-0.2)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                onClick={handleReset}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="absolute top-4 right-4 z-10 bg-gray-800 rounded-lg p-3 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-300">
            <Square className="h-4 w-4 inline mr-1" />
            {boxCount} boxes
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
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

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-20">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-gray-300">Loading image and annotations...</p>
          </div>
        </div>
      )}

      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
