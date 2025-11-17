'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, Rect, Image as FabricImage, TPointerEventInfo, TPointerEvent, FabricObject } from 'fabric';
import {
  Save,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Square,
  Trash2,
  Tag,
} from 'lucide-react';

interface AnnotationToolProps {
  orgId: string;
  projectId: string;
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

// Extend FabricObject to include custom data property
interface AnnotatedFabricObject extends FabricObject {
  data?: { label: string };
}

export function AnnotationTool({ orgId, projectId }: AnnotationToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('default_panel');
  const [boxCount, setBoxCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const currentRectRef = useRef<Rect | null>(null);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: window.innerWidth,
      height: window.innerHeight - 120,
      backgroundColor: '#1f2937',
      selection: true,
    });

    fabricCanvasRef.current = canvas;

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
  }, []);

  // Load image and annotations
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    async function loadData() {
      try {
        // Get image URL and annotations from API
        const response = await fetch(
          `/api/projects/${orgId}/${projectId}/annotations`
        );
        if (!response.ok) throw new Error('Failed to load data');

        const { imageUrl, annotations } = await response.json();

        // Load image
        const img = await FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' });

        const canvas = fabricCanvasRef.current!;

        // Center and scale image to fit
        const scale = Math.min(
          (canvas.width! - 100) / img.width!,
          (canvas.height! - 100) / img.height!
        );

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
          boxes.forEach((box: BoundingBox) => {
            const labelConfig = LABELS.find((l) => l.id === box.label);
            const rect = new Rect({
              left: 50 + box.left * scale,
              top: 50 + box.top * scale,
              width: box.width * scale,
              height: box.height * scale,
              fill: 'transparent',
              stroke: labelConfig?.color || '#22c55e',
              strokeWidth: 2,
              cornerColor: labelConfig?.color || '#22c55e',
              cornerSize: 8,
              transparentCorners: false,
              data: { label: box.label },
            });
            canvas.add(rect);
          });
          setBoxCount(boxes.length);
        }

        setImageLoaded(true);
        canvas.renderAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [orgId, projectId]);

  // Drawing handlers
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !imageLoaded) return;

    const handleMouseDown = (e: TPointerEventInfo<TPointerEvent>) => {
      if (!e.pointer) return;

      // Only start drawing if clicking on empty space
      if (canvas.getActiveObject()) return;

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
        strokeWidth: 2,
        cornerColor: labelConfig?.color || '#22c55e',
        cornerSize: 8,
        transparentCorners: false,
        data: { label: selectedLabel },
      });

      currentRectRef.current = rect;
      canvas.add(rect);
    };

    const handleMouseMove = (e: TPointerEventInfo<TPointerEvent>) => {
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
      if (!isDrawingRef.current || !currentRectRef.current) return;

      isDrawingRef.current = false;
      const rect = currentRectRef.current;

      // Remove if too small
      if (rect.width! < 10 || rect.height! < 10) {
        canvas.remove(rect);
      } else {
        rect.set('fill', 'transparent');
        setBoxCount((prev) => prev + 1);
      }

      currentRectRef.current = null;
      startPointRef.current = null;
      canvas.renderAll();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
    };
  }, [imageLoaded, selectedLabel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active && active.type === 'rect') {
          canvas.remove(active);
          setBoxCount((prev) => prev - 1);
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
      // Ctrl+S to save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
        const annotatedObj = obj as AnnotatedFabricObject;
        if (obj.type === 'rect' && annotatedObj.data?.label) {
          boxes.push({
            left: Math.round((obj.left! - offsetX) / scale),
            top: Math.round((obj.top! - offsetY) / scale),
            width: Math.round(obj.width! * (obj.scaleX || 1) / scale),
            height: Math.round(obj.height! * (obj.scaleY || 1) / scale),
            label: annotatedObj.data.label,
          });
        }
      });

      // Save to S3
      const response = await fetch(
        `/api/projects/${orgId}/${projectId}/annotations`,
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
  }, [orgId, projectId]);

  const handleZoom = (delta: number) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const newZoom = Math.max(0.1, Math.min(5, zoom + delta));
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
      const labelConfig = LABELS.find((l) => l.id === selectedLabel);
      active.set({
        stroke: labelConfig?.color || '#22c55e',
        cornerColor: labelConfig?.color || '#22c55e',
        data: { label: selectedLabel },
      });
      canvas.renderAll();
    }
  };

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
            <div className="grid grid-cols-2 gap-2">
              {LABELS.map((label, index) => (
                <button
                  key={label.id}
                  onClick={() => setSelectedLabel(label.id)}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
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
              ))}
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
