import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ROBLOX_TERRAIN } from '../domain/roblox';
import { CorridorKind, CorridorPoint, isSelectionPolygon, SelectionRect, SelectionRegion, TerrainProject, ViewMode } from '../domain/terrain';
import { renderTerrainBitmap } from '../render/terrainBitmap';

type MapPoint = { x: number; y: number };

type TerrainViewportProps = {
  project: TerrainProject;
  revision: number;
  dirtyRegion?: SelectionRect | null;
  viewMode: ViewMode;
  brushRadiusStuds: number;
  fitSignal: number;
  materialOverride?: Uint8Array | null;
  isSpacePressed: boolean;
  onBrush: (point: MapPoint) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
  onSample: (point: MapPoint) => void;
  onPointerInfo: (point: MapPoint | null) => void;
  selectionMode?: boolean;
  selection?: SelectionRegion | null;
  selectionDraft?: SelectionRect | null;
  selectionShape?: 'rectangle' | 'polygon';
  onSelectionStart?: (point: MapPoint) => void;
  onSelectionUpdate?: (point: MapPoint) => void;
  onSelectionEnd?: () => void;
  selectionPolygonDraft?: CorridorPoint[];
  onPolygonPoint?: (point: MapPoint) => void;
  onPolygonFinish?: () => void;
  splineMode?: CorridorKind | null;
  splinePoints?: CorridorPoint[];
  onSplinePoint?: (point: MapPoint) => void;
  onSplinePointMove?: (index: number, point: MapPoint) => void;
};

type PixiState = {
  app: Application;
  scene: Container;
  bitmapSprite: Sprite | null;
  grid: Graphics;
  brush: Graphics;
  selection: Graphics;
  spline: Graphics;
};

type BitmapCache = {
  project: TerrainProject;
  viewMode: ViewMode;
  materialOverride?: Uint8Array | null;
  canvas: HTMLCanvasElement;
};

export function TerrainViewport({ project, revision, dirtyRegion = null, viewMode, brushRadiusStuds, fitSignal, materialOverride, isSpacePressed, onBrush, onStrokeStart, onStrokeEnd, onSample, onPointerInfo, selectionMode = false, selection = null, selectionDraft = null, selectionShape = 'rectangle', onSelectionStart, onSelectionUpdate, onSelectionEnd, selectionPolygonDraft = [], onPolygonPoint, onPolygonFinish, splineMode = null, splinePoints = [], onSplinePoint, onSplinePointMove }: TerrainViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiState | null>(null);
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const dragRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const paintingRef = useRef(false);
  const lastPaintPointRef = useRef<MapPoint | null>(null);
  const selectingRef = useRef(false);
  const splineDragRef = useRef<number | null>(null);
  const bitmapCacheRef = useRef<BitmapCache | null>(null);
  const [pixiReady, setPixiReady] = useState(0);
  const [pointer, setPointer] = useState<MapPoint | null>(null);
  const [viewLabel, setViewLabel] = useState('100%');

  function fitView(): void {
    const host = hostRef.current;
    if (!host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const zoom = Math.max(0.08, Math.min(2, Math.min((width - 64) / project.width, (height - 64) / project.height)));
    viewRef.current = { zoom, x: (width - project.width * zoom) / 2, y: (height - project.height * zoom) / 2 };
    setViewLabel(`${Math.round(zoom * 100)}%`);
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    const scene = new Container();
    const grid = new Graphics();
    const brush = new Graphics();
    const selectionOverlay = new Graphics();
    const splineOverlay = new Graphics();
    let cancelled = false;
    app.init({ background: '#0d1318', antialias: true, resizeTo: host, resolution: Math.min(window.devicePixelRatio || 1, 2) }).then(() => {
      if (cancelled) return;
      host.appendChild(app.canvas);
      scene.addChild(grid);
      scene.addChild(selectionOverlay);
      scene.addChild(splineOverlay);
      scene.addChild(brush);
      app.stage.addChild(scene);
      pixiRef.current = { app, scene, bitmapSprite: null, grid, brush, selection: selectionOverlay, spline: splineOverlay };
      fitView();
      setPixiReady((value) => value + 1);
    });
    return () => {
      cancelled = true;
      if (pixiRef.current) pixiRef.current.app.destroy(true, { children: true });
      pixiRef.current = null;
      bitmapCacheRef.current = null;
    };
    // The project dimensions define the renderer lifetime. Content refreshes below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.width, project.height]);

  useEffect(() => {
    const state = pixiRef.current;
    const host = hostRef.current;
    if (!state || !host) return;
    const cache = bitmapCacheRef.current;
    const canPatch = Boolean(dirtyRegion && cache && cache.project === project && cache.viewMode === viewMode && cache.materialOverride === materialOverride);
    const bitmap = renderTerrainBitmap(project, viewMode, 768, materialOverride, canPatch ? cache?.canvas : undefined, canPatch ? dirtyRegion : null);
    bitmapCacheRef.current = { project, viewMode, materialOverride, canvas: bitmap };
    if (state.bitmapSprite) {
      state.scene.removeChild(state.bitmapSprite);
      state.bitmapSprite.destroy({ texture: true });
    }
    state.bitmapSprite = new Sprite(Texture.from(bitmap));
    state.bitmapSprite.width = project.width;
    state.bitmapSprite.height = project.height;
    state.scene.addChildAt(state.bitmapSprite, 0);
    state.scene.position.set(viewRef.current.x, viewRef.current.y);
    state.scene.scale.set(viewRef.current.zoom);

    const gridStep = project.width > 2048 ? 256 : project.width > 1024 ? 128 : 64;
    state.grid.clear();
    for (let x = 0; x <= project.width; x += gridStep) state.grid.moveTo(x, 0).lineTo(x, project.height);
    for (let y = 0; y <= project.height; y += gridStep) state.grid.moveTo(0, y).lineTo(project.width, y);
    state.grid.stroke({ color: 0xd9e5dc, alpha: 0.13, width: 1 / Math.max(viewRef.current.zoom, 0.1) });
  }, [project, revision, dirtyRegion, viewMode, materialOverride, pixiReady]);

  useEffect(() => {
    const state = pixiRef.current;
    if (!state) return;
    state.selection.clear();
    const activeSelection = selectionDraft ?? selection;
    if (activeSelection && isSelectionPolygon(activeSelection)) {
      if (activeSelection.points.length >= 2) {
        state.selection.moveTo(activeSelection.points[0].x, activeSelection.points[0].y);
        for (const point of activeSelection.points.slice(1)) state.selection.lineTo(point.x, point.y);
        state.selection.lineTo(activeSelection.points[0].x, activeSelection.points[0].y);
        state.selection.fill({ color: 0xc5f74f, alpha: 0.08 }).stroke({ color: 0xc5f74f, alpha: 0.95, width: 2 / Math.max(viewRef.current.zoom, 0.1) });
      }
    } else if (activeSelection) {
      const x = Math.min(activeSelection.x0, activeSelection.x1);
      const y = Math.min(activeSelection.y0, activeSelection.y1);
      const width = Math.abs(activeSelection.x1 - activeSelection.x0);
      const height = Math.abs(activeSelection.y1 - activeSelection.y0);
      state.selection.rect(x, y, width, height).fill({ color: 0xc5f74f, alpha: 0.08 }).stroke({ color: 0xc5f74f, alpha: 0.95, width: 2 / Math.max(viewRef.current.zoom, 0.1) });
    }
    if (selectionShape === 'polygon' && selectionPolygonDraft.length >= 2) {
      state.selection.moveTo(selectionPolygonDraft[0].x, selectionPolygonDraft[0].y);
      for (const point of selectionPolygonDraft.slice(1)) state.selection.lineTo(point.x, point.y);
      if (pointer) state.selection.lineTo(pointer.x, pointer.y);
      state.selection.stroke({ color: 0xc5f74f, alpha: 0.9, width: 2 / Math.max(viewRef.current.zoom, 0.1) });
      for (const point of selectionPolygonDraft) state.selection.circle(point.x, point.y, 4 / Math.max(viewRef.current.zoom, 0.1)).fill({ color: 0xc5f74f, alpha: 1 });
    }
    state.spline.clear();
    if (splineMode && splinePoints.length > 0) {
      const path = pointer && !selectionMode ? [...splinePoints, pointer] : splinePoints;
      state.spline.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) state.spline.lineTo(point.x, point.y);
      state.spline.stroke({ color: splineMode === 'road' ? 0xf0c674 : 0x73c8d1, alpha: 0.95, width: 3 / Math.max(viewRef.current.zoom, 0.1) });
      for (const point of splinePoints) state.spline.circle(point.x, point.y, 5 / Math.max(viewRef.current.zoom, 0.1)).fill({ color: splineMode === 'road' ? 0xf0c674 : 0x73c8d1, alpha: 1 });
    }
    state.brush.clear();
    if (pointer && !selectionMode) {
      state.brush.circle(pointer.x, pointer.y, brushRadiusStuds / 4).stroke({ color: 0xc5f74f, alpha: 0.95, width: 2 / Math.max(viewRef.current.zoom, 0.1) });
      state.brush.circle(pointer.x, pointer.y, 2 / Math.max(viewRef.current.zoom, 0.1)).fill({ color: 0xc5f74f, alpha: 0.9 });
    }
  }, [project, brushRadiusStuds, pointer, selection, selectionDraft, selectionMode, selectionShape, selectionPolygonDraft, splineMode, splinePoints, viewLabel, pixiReady]);

  useEffect(() => {
    if (fitSignal === 0) return;
    fitView();
    const state = pixiRef.current;
    if (state) {
      state.scene.position.set(viewRef.current.x, viewRef.current.y);
      state.scene.scale.set(viewRef.current.zoom);
    }
  }, [fitSignal]);

  function mapPointFromEvent(event: PointerEvent<HTMLDivElement>): MapPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    const view = viewRef.current;
    return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 && event.button !== 1) return;
    const point = mapPointFromEvent(event);
    if (isSpacePressed || event.button === 1) {
      dragRef.current = { clientX: event.clientX, clientY: event.clientY, x: viewRef.current.x, y: viewRef.current.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.altKey) {
      onSample(point);
      return;
    }
    if (selectionMode) {
      if (selectionShape === 'polygon') {
        const hitRadius = Math.max(10 / Math.max(viewRef.current.zoom, 0.1), 1);
        const first = selectionPolygonDraft[0];
        if (first && selectionPolygonDraft.length >= 3 && Math.hypot(first.x - point.x, first.y - point.y) <= hitRadius) onPolygonFinish?.();
        else onPolygonPoint?.(point);
        setPointer(point);
        onPointerInfo(point);
        return;
      }
      selectingRef.current = true;
      onSelectionStart?.(point);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (splineMode) {
      const hitRadius = Math.max(8 / Math.max(viewRef.current.zoom, 0.1), 1);
      const pointIndex = splinePoints.findIndex((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= hitRadius);
      if (pointIndex >= 0) {
        splineDragRef.current = pointIndex;
        event.currentTarget.setPointerCapture(event.pointerId);
        setPointer(point);
        onPointerInfo(point);
        return;
      }
      onSplinePoint?.(point);
      setPointer(point);
      onPointerInfo(point);
      return;
    }
    paintingRef.current = true;
    lastPaintPointRef.current = point;
    onStrokeStart();
    event.currentTarget.setPointerCapture(event.pointerId);
    onBrush(point);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const point = mapPointFromEvent(event);
    if (dragRef.current) {
      viewRef.current.x = dragRef.current.x + event.clientX - dragRef.current.clientX;
      viewRef.current.y = dragRef.current.y + event.clientY - dragRef.current.clientY;
      const state = pixiRef.current;
      if (state) state.scene.position.set(viewRef.current.x, viewRef.current.y);
      return;
    }
    if (splineDragRef.current !== null) {
      onSplinePointMove?.(splineDragRef.current, point);
      setPointer(point);
      onPointerInfo(point);
      return;
    }
    if (selectingRef.current) {
      onSelectionUpdate?.(point);
      return;
    }
    if (selectionMode && selectionShape === 'polygon') {
      setPointer(point);
      onPointerInfo(point);
      return;
    }
    if (point.x < 0 || point.y < 0 || point.x >= project.width || point.y >= project.height) {
      setPointer(null);
      onPointerInfo(null);
      return;
    }
    setPointer(point);
    onPointerInfo(point);
    if (paintingRef.current) {
      const previous = lastPaintPointRef.current ?? point;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const spacing = Math.max(1, brushRadiusStuds / ROBLOX_TERRAIN.studsPerSample * 0.35);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        onBrush({ x: previous.x + (point.x - previous.x) * progress, y: previous.y + (point.y - previous.y) * progress });
      }
      lastPaintPointRef.current = point;
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    dragRef.current = null;
    splineDragRef.current = null;
    if (selectingRef.current) onSelectionEnd?.();
    selectingRef.current = false;
    if (paintingRef.current) onStrokeEnd();
    paintingRef.current = false;
    lastPaintPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const current = viewRef.current;
    const mapX = (cursorX - current.x) / current.zoom;
    const mapY = (cursorY - current.y) / current.zoom;
    const zoom = Math.max(0.05, Math.min(8, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    viewRef.current = { zoom, x: cursorX - mapX * zoom, y: cursorY - mapY * zoom };
    setViewLabel(`${Math.round(zoom * 100)}%`);
    const state = pixiRef.current;
    if (state) {
      state.scene.position.set(viewRef.current.x, viewRef.current.y);
      state.scene.scale.set(viewRef.current.zoom);
    }
  }

  return (
    <div ref={hostRef} className={`terrain-viewport ${isSpacePressed ? 'panning' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={() => { if (!paintingRef.current) { setPointer(null); onPointerInfo(null); } }} onWheel={handleWheel}>
      <div className="viewport-ruler viewport-ruler-top"><span>0</span><span>{Math.round(project.width / 2 * 4).toLocaleString()} studs</span><span>{(project.width * 4).toLocaleString()} studs</span></div>
      <div className="viewport-ruler viewport-ruler-left"><span>0</span><span>{Math.round(project.height / 2 * 4).toLocaleString()}</span><span>{(project.height * 4).toLocaleString()}</span></div>
      <div className="viewport-readout"><span className="view-mode-dot" />{viewMode === 'height' ? 'Height field' : viewMode === 'materials' ? 'Material map' : viewMode === 'combined' ? 'Height + materials' : viewMode === 'slope' ? 'Slope analysis' : 'Protection mask'}<b>{viewLabel}</b></div>
      <div className="viewport-hint"><span>Left mouse sculpt</span><span>Space + drag pan</span><span>Wheel zoom</span></div>
    </div>
  );
}
