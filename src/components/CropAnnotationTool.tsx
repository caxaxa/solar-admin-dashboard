'use client';

import { useEffect, useRef, useState } from 'react';
import { Canvas, FabricImage, Polygon, Line, Circle, Point as FabricPoint } from 'fabric';
import { Loader2, Save, RotateCcw, Trash2, MousePointer, Pentagon, Minus } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface CropAnnotations {
  polygon: Point[];
  rotationLine: {
    start: Point;
    end: Point;
  } | null;
  isDouble: boolean;
  isVertical: boolean;
  is2H: boolean;
}

interface CropAnnotationToolProps {
  orgId: string;
  projectId: string;
  env: string;
}

type ToolMode = 'select' | 'polygon' | 'line';

export function CropAnnotationTool({ orgId, projectId, env }: CropAnnotationToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasInstanceRef = useRef<Canvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const toolModeRef = useRef<ToolMode>('select'); // Keep ref in sync with state
  const [imageScale, setImageScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  // Annotation state
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [rotationLine, setRotationLine] = useState<{ start: Point; end: Point } | null>(null);
  const [isDouble, setIsDouble] = useState(false);
  const [isVertical, setIsVertical] = useState(false);
  const [is2H, setIs2H] = useState(false);

  // Temporary drawing state
  const tempPointsRef = useRef<Point[]>([]);
  const [tempPointsCount, setTempPointsCount] = useState(0); // Track count for UI updates
  const lineStartRef = useRef<Point | null>(null);
  const polygonObjectRef = useRef<Polygon | null>(null);
  const lineObjectRef = useRef<Line | null>(null);
  const pointMarkersRef = useRef<Circle[]>([]);

  // Sync toolMode state with ref
  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  // First effect: Fetch data and set loading to false
  useEffect(() => {
    console.log('CropAnnotationTool mounted!', { orgId, projectId, env });

    async function fetchData() {
      try {
        console.log('Fetching crop annotations...');
        const response = await fetch(
          `/api/projects/${orgId}/${projectId}/crop-annotations?env=${env}`
        );

        if (!response.ok) throw new Error('Failed to load annotations');

        const data = await response.json();
        console.log('API response:', data);

        // Store data temporarily
        sessionStorage.setItem('cropImageUrl', data.imageUrl);
        sessionStorage.setItem('cropAnnotations', JSON.stringify(data.annotations));
        sessionStorage.setItem('cropImageMetadata', JSON.stringify(data.imageMetadata));

        setLoading(false);
      } catch (err) {
        console.error('fetchData failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
      }
    }

    fetchData();
  }, [orgId, projectId, env]);

  // Second effect: Initialize canvas after loading is complete
  useEffect(() => {
    if (loading || !canvasRef.current) {
      return;
    }

    console.log('Initializing Fabric canvas...');
    let canvas: Canvas;

    try {
      canvas = new Canvas(canvasRef.current, {
        width: window.innerWidth - 400,
        height: window.innerHeight - 200,
        backgroundColor: '#1f2937',
        selection: false,
      });
      console.log('Canvas created successfully');
    } catch (err) {
      console.error('Failed to create canvas:', err);
      setError('Failed to initialize canvas');
      return;
    }

    canvasInstanceRef.current = canvas;

    // Load image from sessionStorage
    loadImageFromStorage(canvas);

    // Enable zoom with mouse wheel
    canvas.on('mouse:wheel', (opt) => {
      const evt = opt.e as WheelEvent;
      const delta = evt.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 20) zoom = 20;
      if (zoom < 0.1) zoom = 0.1;
      canvas.zoomToPoint(new FabricPoint(opt.e.offsetX, opt.e.offsetY), zoom);
      evt.preventDefault();
      evt.stopPropagation();
    });

    // Unified mouse event handling for panning and drawing
    let isPanning = false;
    let lastPosX = 0;
    let lastPosY = 0;

    canvas.on('mouse:down', (opt) => {
      const evt = opt.e as MouseEvent;
      if (!opt.pointer) return;

      // Check if we should pan (select mode, or middle mouse, or shift+click)
      if (toolModeRef.current === 'select' || evt.button === 1 || evt.shiftKey) {
        isPanning = true;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        canvas.selection = false;
        return;
      }

      // Otherwise, handle drawing - use absolute pointer which accounts for zoom/pan
      const pointer = canvas.getScenePoint(evt);
      handleMouseDown(pointer.x, pointer.y);
    });

    canvas.on('mouse:move', (opt) => {
      const evt = opt.e as MouseEvent;

      if (isPanning) {
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] += evt.clientX - lastPosX;
          vpt[5] += evt.clientY - lastPosY;
          canvas.requestRenderAll();
          lastPosX = evt.clientX;
          lastPosY = evt.clientY;
        }
        return;
      }

      // Handle drawing mouse move - use absolute pointer which accounts for zoom/pan
      const pointer = canvas.getScenePoint(evt);
      handleMouseMove(pointer.x, pointer.y);
    });

    canvas.on('mouse:up', () => {
      isPanning = false;
      canvas.selection = false;
    });

    return () => {
      if (canvasInstanceRef.current) {
        console.log('Disposing canvas...');
        canvasInstanceRef.current.dispose();
        canvasInstanceRef.current = null;
      }
    };
  }, [loading]);

  const loadImageFromStorage = async (canvas: Canvas) => {
    try {
      const imageUrl = sessionStorage.getItem('cropImageUrl');
      const annotationsStr = sessionStorage.getItem('cropAnnotations');

      if (!imageUrl || !annotationsStr) {
        throw new Error('Missing data in session storage');
      }

      const annotations = JSON.parse(annotationsStr) as CropAnnotations;
      console.log('Loading image and annotations from storage');

      // Load the image using HTML Image element first for better CORS handling
      console.log('Loading image from:', imageUrl.substring(0, 100) + '...');

      const htmlImg = new Image();
      htmlImg.crossOrigin = 'anonymous';

      const img = await new Promise<FabricImage>((resolve, reject) => {
        htmlImg.onload = () => {
          console.log('HTML Image loaded:', htmlImg.width, 'x', htmlImg.height);
          const fabricImg = new FabricImage(htmlImg);
          resolve(fabricImg);
        };
        htmlImg.onerror = (err) => {
          console.error('Failed to load image:', err);
          reject(new Error('Failed to load image'));
        };
        htmlImg.src = imageUrl;
      });

      console.log('Image loaded successfully:', img.width, 'x', img.height);

      // Calculate scale to fit in canvas
      const canvasWidth = canvas.width!;
      const canvasHeight = canvas.height!;
      const imgWidth = img.width!;
      const imgHeight = img.height!;

      const scale = Math.min(
        canvasWidth / imgWidth,
        canvasHeight / imgHeight
      ) * 0.9;

      const offsetX = (canvasWidth - imgWidth * scale) / 2;
      const offsetY = (canvasHeight - imgHeight * scale) / 2;

      setImageScale(scale);
      setImageOffset({ x: offsetX, y: offsetY });

      img.set({
        scaleX: scale,
        scaleY: scale,
        left: offsetX,
        top: offsetY,
        selectable: false,
        evented: false,
      });

      canvas.add(img);
      canvas.sendObjectToBack(img);

      // Load existing annotations
      if (annotations) {
        const { polygon, rotationLine: line, isDouble: dbl, isVertical: vert, is2H: h2 } = annotations;

        setIsDouble(dbl);
        setIsVertical(vert);
        setIs2H(h2);

        if (polygon && polygon.length > 0) {
          setPolygonPoints(polygon);
          drawPolygon(canvas, polygon);
        }

        if (line) {
          setRotationLine(line);
          drawLine(canvas, line);
        }
      }

      canvas.renderAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  };

  const canvasToImageCoords = (x: number, y: number): Point => {
    return {
      x: Math.round((x - imageOffset.x) / imageScale),
      y: Math.round((y - imageOffset.y) / imageScale),
    };
  };

  const imageToCanvasCoords = (x: number, y: number): Point => {
    return {
      x: x * imageScale + imageOffset.x,
      y: y * imageScale + imageOffset.y,
    };
  };

  const drawPolygon = (canvas: Canvas, points: Point[]) => {
    // Remove existing polygon
    if (polygonObjectRef.current) {
      canvas.remove(polygonObjectRef.current);
    }
    // Remove point markers
    pointMarkersRef.current.forEach(marker => canvas.remove(marker));
    pointMarkersRef.current = [];

    if (points.length < 3) return;

    const canvasPoints = points.map(p => imageToCanvasCoords(p.x, p.y));

    const polygon = new Polygon(canvasPoints, {
      fill: 'rgba(59, 130, 246, 0.2)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });

    canvas.add(polygon);
    polygonObjectRef.current = polygon;

    // Add point markers
    canvasPoints.forEach(point => {
      const circle = new Circle({
        radius: 6,
        fill: '#3b82f6',
        stroke: '#ffffff',
        strokeWidth: 2,
        left: point.x,
        top: point.y,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      canvas.add(circle);
      pointMarkersRef.current.push(circle);
    });
  };

  const drawLine = (canvas: Canvas, line: { start: Point; end: Point }) => {
    // Remove existing line
    if (lineObjectRef.current) {
      canvas.remove(lineObjectRef.current);
    }

    const start = imageToCanvasCoords(line.start.x, line.start.y);
    const end = imageToCanvasCoords(line.end.x, line.end.y);

    const lineObj = new Line([start.x, start.y, end.x, end.y], {
      stroke: '#ef4444',
      strokeWidth: 3,
      selectable: false,
      evented: false,
    });

    canvas.add(lineObj);
    lineObjectRef.current = lineObj;

    // Add end markers
    const startMarker = new Circle({
      radius: 8,
      fill: '#ef4444',
      stroke: '#ffffff',
      strokeWidth: 2,
      left: start.x,
      top: start.y,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    const endMarker = new Circle({
      radius: 8,
      fill: '#ef4444',
      stroke: '#ffffff',
      strokeWidth: 2,
      left: end.x,
      top: end.y,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    canvas.add(startMarker);
    canvas.add(endMarker);
    pointMarkersRef.current.push(startMarker, endMarker);
  };

  const handleMouseDown = (x: number, y: number) => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;

    console.log('handleMouseDown', { x, y, toolMode: toolModeRef.current });

    if (toolModeRef.current === 'polygon') {
      const imgCoords = canvasToImageCoords(x, y);
      tempPointsRef.current.push(imgCoords);
      setTempPointsCount(tempPointsRef.current.length); // Update state for UI
      console.log('Added polygon point', imgCoords, 'total points:', tempPointsRef.current.length);

      // Add visual marker for the point
      const circle = new Circle({
        radius: 6,
        fill: '#fbbf24',
        stroke: '#ffffff',
        strokeWidth: 2,
        left: x,
        top: y,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      canvas.add(circle);
      pointMarkersRef.current.push(circle);

      // If we have at least 3 points, draw preview polygon
      if (tempPointsRef.current.length >= 3) {
        drawPolygon(canvas, tempPointsRef.current);
      }

      canvas.renderAll();
    } else if (toolModeRef.current === 'line') {
      const imgCoords = canvasToImageCoords(x, y);

      if (!lineStartRef.current) {
        console.log('Line start point', imgCoords);
        lineStartRef.current = imgCoords;
        // Add start marker
        const circle = new Circle({
          radius: 8,
          fill: '#fbbf24',
          stroke: '#ffffff',
          strokeWidth: 2,
          left: x,
          top: y,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        canvas.add(circle);
        pointMarkersRef.current.push(circle);
        canvas.renderAll();
      } else {
        // Complete the line
        console.log('Line end point', imgCoords);
        const newLine = {
          start: lineStartRef.current,
          end: imgCoords,
        };
        setRotationLine(newLine);
        drawLine(canvas, newLine);
        lineStartRef.current = null;
        setToolMode('select');
        canvas.renderAll();
      }
    }
  };

  const handleMouseMove = (x: number, y: number) => {
    // Could add preview line while drawing
  };

  const finishPolygon = () => {
    if (tempPointsRef.current.length < 3) {
      alert('A polygon needs at least 3 points');
      return;
    }

    setPolygonPoints([...tempPointsRef.current]);
    tempPointsRef.current = [];
    setTempPointsCount(0);
    setToolMode('select');
  };

  const clearPolygon = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;

    if (polygonObjectRef.current) {
      canvas.remove(polygonObjectRef.current);
      polygonObjectRef.current = null;
    }
    pointMarkersRef.current.forEach(marker => canvas.remove(marker));
    pointMarkersRef.current = [];

    setPolygonPoints([]);
    tempPointsRef.current = [];
    setTempPointsCount(0);
    canvas.renderAll();
  };

  const clearLine = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;

    if (lineObjectRef.current) {
      canvas.remove(lineObjectRef.current);
      lineObjectRef.current = null;
    }

    setRotationLine(null);
    lineStartRef.current = null;
    canvas.renderAll();
  };

  const saveAnnotations = async () => {
    if (polygonPoints.length < 3) {
      alert('Please draw a crop polygon with at least 3 points');
      return;
    }

    setSaving(true);
    try {
      const annotations: CropAnnotations = {
        polygon: polygonPoints,
        rotationLine,
        isDouble,
        isVertical,
        is2H,
      };

      const response = await fetch(
        `/api/projects/${orgId}/${projectId}/crop-annotations?env=${env}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(annotations),
        }
      );

      if (!response.ok) throw new Error('Failed to save');

      alert('Crop annotations saved successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-white">Loading orthophoto...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-6 text-red-200">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Canvas area */}
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="block" />

        {/* Tool mode indicator */}
        <div className="absolute top-4 left-4 bg-gray-800 px-4 py-2 rounded-lg text-white">
          Mode: <span className="font-bold capitalize">{toolMode}</span>
          {toolMode === 'polygon' && tempPointsRef.current.length > 0 && (
            <span className="ml-2 text-yellow-400">
              ({tempPointsRef.current.length} points)
            </span>
          )}
          {toolMode === 'line' && lineStartRef.current && (
            <span className="ml-2 text-yellow-400">
              (click end point)
            </span>
          )}
        </div>

        {/* Controls help */}
        <div className="absolute bottom-4 left-4 bg-gray-800/90 px-4 py-3 rounded-lg text-xs text-gray-300 space-y-1">
          <div><strong>Zoom:</strong> Mouse wheel</div>
          <div><strong>Pan/Drag:</strong> Select mode (hand icon) or Shift + Drag</div>
          <div><strong>Draw:</strong> Click Polygon or Line, then click on image</div>
        </div>
      </div>

      {/* Control panel */}
      <div className="w-80 bg-gray-800 p-4 flex flex-col gap-4 overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-2">Crop Annotations</h2>

        {/* Tool selection */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Drawing Tools</h3>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setToolMode('select')}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                toolMode === 'select'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <MousePointer className="h-5 w-5" />
              <span className="text-xs">Select</span>
            </button>
            <button
              onClick={() => setToolMode('polygon')}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                toolMode === 'polygon'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Pentagon className="h-5 w-5" />
              <span className="text-xs">Polygon</span>
            </button>
            <button
              onClick={() => setToolMode('line')}
              className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                toolMode === 'line'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Minus className="h-5 w-5" />
              <span className="text-xs">Line</span>
            </button>
          </div>
        </div>

        {/* Polygon controls */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Crop Polygon</h3>
          <div className="bg-gray-700 p-3 rounded-lg">
            <p className="text-xs text-gray-400 mb-2">
              Click points on the image to define the crop region. Need at least 3 points.
            </p>
            <div className="flex gap-2">
              {toolMode === 'polygon' && tempPointsCount >= 3 && (
                <button
                  onClick={finishPolygon}
                  className="flex-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                >
                  Finish Polygon
                </button>
              )}
              <button
                onClick={clearPolygon}
                className="flex items-center justify-center gap-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Points: {polygonPoints.length > 0 ? polygonPoints.length : tempPointsCount}
            </p>
          </div>
        </div>

        {/* Rotation line controls */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Rotation Line</h3>
          <div className="bg-gray-700 p-3 rounded-lg">
            <p className="text-xs text-gray-400 mb-2">
              Draw a line along the tracker inclination for rotation correction.
            </p>
            <button
              onClick={clearLine}
              className="flex items-center justify-center gap-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm w-full"
            >
              <Trash2 className="h-4 w-4" />
              Clear Line
            </button>
            <p className="text-xs text-gray-400 mt-2">
              {rotationLine ? 'Line defined' : 'No line drawn'}
            </p>
          </div>
        </div>

        {/* Boolean options */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Configuration</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isDouble}
                onChange={(e) => setIsDouble(e.target.checked)}
                className="w-5 h-5 rounded border-gray-500 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-white">Is Double Tracker</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isVertical}
                onChange={(e) => setIsVertical(e.target.checked)}
                className="w-5 h-5 rounded border-gray-500 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-white">Is Horizontal</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={is2H}
                onChange={(e) => setIs2H(e.target.checked)}
                className="w-5 h-5 rounded border-gray-500 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-white">Is 2H</span>
            </label>
          </div>
        </div>

        {/* Save button */}
        <div className="mt-auto pt-4 border-t border-gray-700">
          <button
            onClick={saveAnnotations}
            disabled={saving || polygonPoints.length < 3}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" />
            )}
            Save Annotations
          </button>
          {polygonPoints.length < 3 && (
            <p className="text-xs text-yellow-400 mt-2 text-center">
              Draw a crop polygon to enable saving
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
