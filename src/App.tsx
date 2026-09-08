import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { StartScreen } from './components/StartScreen';
import { TerrainPreview } from './components/TerrainPreview';
import { TerrainViewport } from './components/TerrainViewport';
import { clearRecoverySnapshot, ColormapColorMapping, deserializeProject, exportTerrainAssets, getRecentProjects, getRecoveryProject, importColormapFile, importHeightmapFile, inspectColormapFile, projectFileName, readProjectFile, rememberProject, serializeProjectAsync, saveProjectDownloadAsync, saveRecoverySnapshot } from './domain/project';
import { ROBLOX_MATERIALS } from './domain/roblox';
import { clearDirtyTiles, createFloat32TileBuffer } from './domain/tileBuffer';
import { clearNativeRecovery, isTauriRuntime, openNativeProject, readNativeRecovery, saveNativeProject, writeNativeProject, writeNativeRecovery } from './platform/nativeProject';
import {
  applyBrushStroke,
  applyCorridorAsync,
  applyChanges,
  applyMaterialMap,
  BIOME_PRESETS,
  BiomeId,
  brushToolLabels,
  compositeHeightAt,
  createTerrainProject,
  createTerrainProjectAsync,
  CorridorKind,
  CorridorPoint,
  CorridorRecord,
  defaultMaterialRules,
  EditChange,
  isSelectionPolygon,
  MaterialRule,
  materialAt,
  MaterialLayer,
  ProceduralPreset,
  SelectionRect,
  SelectionRegion,
  slopeDegreesAt,
  TerrainProject,
  TerrainStatistics,
  terrainStatistics,
  ToolId,
  worldHeightFromNormalized,
  worldSizeForResolution,
  ViewMode,
} from './domain/terrain';
import { runTerrainWorker } from './platform/terrainWorker';

type HistoryEntry = { label: string; changes: EditChange[] };
type PanelTab = 'inspector' | 'layers' | 'materials' | 'rules';
type PointerInfo = { x: number; y: number } | null;
type DirtyRegion = SelectionRect;

const toolOrder: Array<{ id: ToolId; glyph: string; label: string; shortcut?: string }> = [
  { id: 'brush', glyph: '＋', label: 'Brush', shortcut: 'B' },
  { id: 'select', glyph: '⌗', label: 'Select' },
  { id: 'raise', glyph: '↗', label: 'Raise' },
  { id: 'lower', glyph: '↘', label: 'Lower' },
  { id: 'smooth', glyph: '≈', label: 'Smooth', shortcut: 'S' },
  { id: 'flatten', glyph: '━', label: 'Flatten', shortcut: 'F' },
  { id: 'noise', glyph: '∿', label: 'Noise' },
  { id: 'terrace', glyph: '▤', label: 'Terrace' },
  { id: 'ridge', glyph: '⌁', label: 'Ridge' },
  { id: 'valley', glyph: '⌄', label: 'Valley' },
  { id: 'plateau', glyph: '▰', label: 'Plateau' },
  { id: 'slope', glyph: '∠', label: 'Slope' },
  { id: 'road', glyph: '⌁', label: 'Road corridor' },
  { id: 'river', glyph: '≈', label: 'River channel' },
  { id: 'paint', glyph: '◒', label: 'Material paint' },
  { id: 'mask', glyph: '◩', label: 'Protect mask' },
];

function formatStuds(value: number): string {
  return `${Math.round(value).toLocaleString()} studs`;
}

  function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function regionForChanges(project: TerrainProject, changes: EditChange[]): DirtyRegion | null {
  let region: DirtyRegion | null = null;
  for (const change of changes) {
    if (change.kind !== 'height' && change.kind !== 'material' && change.kind !== 'material-layer' && change.kind !== 'mask') return null;
    const x = change.index % project.width;
    const y = Math.floor(change.index / project.width);
    region = region ? {
      x0: Math.min(region.x0, x),
      y0: Math.min(region.y0, y),
      x1: Math.max(region.x1, x),
      y1: Math.max(region.y1, y),
    } : { x0: x, y0: y, x1: x, y1: y };
  }
  return region;
}

function clearProjectDirtyTiles(project: TerrainProject): void {
  clearDirtyTiles(project.base);
  clearDirtyTiles(project.materials);
  clearDirtyTiles(project.mask);
  project.layers.forEach((layer) => clearDirtyTiles(layer.values));
  project.materialLayers.forEach((layer) => clearDirtyTiles(layer.coverage));
}

export default function App() {
  const [project, setProject] = useState<TerrainProject | null>(null);
  const projectRef = useRef<TerrainProject | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirtyRegion, setDirtyRegion] = useState<DirtyRegion | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolId>('raise');
  const [viewMode, setViewMode] = useState<ViewMode>('height');
  const [fitSignal, setFitSignal] = useState(0);
  const [panelTab, setPanelTab] = useState<PanelTab>('inspector');
  const [activeLayerId, setActiveLayerId] = useState('base');
  const [activeMaterialLayerId, setActiveMaterialLayerId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionRegion | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionRect | null>(null);
  const [selectionShape, setSelectionShape] = useState<'rectangle' | 'polygon'>('rectangle');
  const [selectionPolygonDraft, setSelectionPolygonDraft] = useState<CorridorPoint[]>([]);
  const [splinePoints, setSplinePoints] = useState<CorridorPoint[]>([]);
  const [corridorWidth, setCorridorWidth] = useState(48);
  const [corridorShoulder, setCorridorShoulder] = useState(48);
  const [corridorDepth, setCorridorDepth] = useState(96);
  const [corridorGrade, setCorridorGrade] = useState(12);
  const [corridorBedMaterial, setCorridorBedMaterial] = useState(() => ROBLOX_MATERIALS.findIndex((material) => material.id === 'sandstone'));
  const [corridorBankMaterial, setCorridorBankMaterial] = useState(() => ROBLOX_MATERIALS.findIndex((material) => material.id === 'grass'));
  const [corridorBusy, setCorridorBusy] = useState(false);
  const [corridorProgress, setCorridorProgress] = useState(0);
  const [maskMode, setMaskMode] = useState<'protect' | 'reveal'>('protect');
  const [brushRadius, setBrushRadius] = useState(128);
  const [strength, setStrength] = useState(0.55);
  const [hardness, setHardness] = useState(0.16);
  const [targetElevation, setTargetElevation] = useState(320);
  const [stepHeightStuds, setStepHeightStuds] = useState(64);
  const [maxSlopeDegrees, setMaxSlopeDegrees] = useState(12);
  const [noiseScale, setNoiseScale] = useState(320);
  const [selectedMaterial, setSelectedMaterial] = useState(0);
  const [pointer, setPointer] = useState<PointerInfo>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [colormapReview, setColormapReview] = useState<{ file: File; mappings: ColormapColorMapping[]; truncated: boolean } | null>(null);
  const [colormapBusy, setColormapBusy] = useState(false);
  const [nativeProjectPath, setNativeProjectPath] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState(getRecentProjects);
  const [recoveryAvailable, setRecoveryAvailable] = useState(() => !isTauriRuntime() && Boolean(getRecoveryProject()));
  const [rules, setRules] = useState<MaterialRule[]>([]);
  const [rulePreview, setRulePreview] = useState<Uint8Array | null>(null);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesProgress, setRulesProgress] = useState(0);
  const [biomeId, setBiomeId] = useState<BiomeId>('temperate');
  const [biomeBusy, setBiomeBusy] = useState(false);
  const [biomeProgress, setBiomeProgress] = useState(0);
  const [buildSlopeThreshold, setBuildSlopeThreshold] = useState(12);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [proceduralPreset, setProceduralPreset] = useState<ProceduralPreset>('rolling-hills');
  const [proceduralSeed, setProceduralSeed] = useState(4817);
  const [proceduralScale, setProceduralScale] = useState(420);
  const [proceduralAmplitude, setProceduralAmplitude] = useState(520);
  const [proceduralEdgeFalloff, setProceduralEdgeFalloff] = useState(1.4);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [openInputKey, setOpenInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const heightmapInputRef = useRef<HTMLInputElement>(null);
  const colormapInputRef = useRef<HTMLInputElement>(null);
  const strokeRef = useRef<Map<string, EditChange>>(new Map());
  const nativeRecoveryRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const revisionFrameRef = useRef<number | null>(null);
  const pendingDirtyRegionRef = useRef<DirtyRegion | null>(null);
  const rulesAbortRef = useRef<AbortController | null>(null);
  const biomeAbortRef = useRef<AbortController | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const corridorAbortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);

  const currentProject = project;
  const currentLayer = currentProject?.layers.find((layer) => layer.id === activeLayerId);
  const cursorStats = useMemo(() => {
    if (!currentProject || !pointer) return null;
    const normalized = compositeHeightAt(currentProject, pointer.x, pointer.y);
    return { elevation: worldHeightFromNormalized(currentProject, normalized), slope: slopeDegreesAt(currentProject, pointer.x, pointer.y), x: Math.round(pointer.x * 4), z: Math.round(pointer.y * 4) };
  }, [currentProject, pointer, revision]);
  const terrainStats = useMemo(() => currentProject && panelTab === 'inspector' ? terrainStatistics(currentProject, buildSlopeThreshold) : null, [currentProject, panelTab, revision, buildSlopeThreshold]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.code === 'Space' && !isTyping) { event.preventDefault(); setIsSpacePressed(true); }
      if (isTyping) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newProject(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openProject(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(event.shiftKey); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setFitSignal((value) => value + 1); }
      if (event.key === '[') setBrushRadius((value) => Math.max(16, value - 16));
      if (event.key === ']') setBrushRadius((value) => Math.min(2048, value + 16));
      if (event.key.toLowerCase() === 'b') setActiveTool('brush');
      if (event.key.toLowerCase() === 'f') setActiveTool('flatten');
      if (event.key.toLowerCase() === 's') setActiveTool('smooth');
      if (event.key === 'Escape') { if (exportOpen) setExportOpen(false); else setActiveTool('brush'); }
    }
    function onKeyUp(event: KeyboardEvent): void { if (event.code === 'Space') setIsSpacePressed(false); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  });

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!currentProject || !dirty) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!isTauriRuntime()) {
        saveRecoverySnapshot(currentProject);
        setRecoveryAvailable(true);
        return;
      }
      void (async () => {
        try {
          const contents = JSON.stringify(await serializeProjectAsync(currentProject));
          if (cancelled) return;
          await writeNativeRecovery(contents);
          nativeRecoveryRef.current = contents;
          setRecoveryAvailable(true);
        } catch { /* Recovery is a safety net; a failed snapshot must not interrupt editing. */ }
      })();
    }, 900);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [currentProject, dirty, revision]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void readNativeRecovery().then((contents) => {
      if (cancelled) return;
      nativeRecoveryRef.current = contents;
      setRecoveryAvailable(Boolean(contents));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (revisionFrameRef.current !== null) window.cancelAnimationFrame(revisionFrameRef.current);
  }, []);

  function announce(message: string): void { setToast(message); }

  function scheduleRenderRevision(region?: DirtyRegion | null): void {
    if (region) {
      const current = pendingDirtyRegionRef.current;
      pendingDirtyRegionRef.current = current ? {
        x0: Math.min(current.x0, region.x0),
        y0: Math.min(current.y0, region.y0),
        x1: Math.max(current.x1, region.x1),
        y1: Math.max(current.y1, region.y1),
      } : region;
    }
    if (revisionFrameRef.current !== null) return;
    revisionFrameRef.current = window.requestAnimationFrame(() => {
      revisionFrameRef.current = null;
      const regionToRender = pendingDirtyRegionRef.current;
      pendingDirtyRegionRef.current = null;
      setDirtyRegion(regionToRender);
      setRevision((value) => { const next = value + 1; revisionRef.current = next; return next; });
    });
  }

  function forceRenderRevision(): void {
    if (revisionFrameRef.current !== null) window.cancelAnimationFrame(revisionFrameRef.current);
    revisionFrameRef.current = null;
    pendingDirtyRegionRef.current = null;
    setDirtyRegion(null);
    setRevision((value) => { const next = value + 1; revisionRef.current = next; return next; });
  }

  function setCurrentProject(next: TerrainProject): void {
    rulesAbortRef.current?.abort();
    biomeAbortRef.current?.abort();
    generationAbortRef.current?.abort();
    corridorAbortRef.current?.abort();
    saveAbortRef.current?.abort();
    rulesAbortRef.current = null;
    biomeAbortRef.current = null;
    generationAbortRef.current = null;
    corridorAbortRef.current = null;
    saveAbortRef.current = null;
    setRulesBusy(false);
    setRulesProgress(0);
    setBiomeBusy(false);
    setBiomeProgress(0);
    setGenerating(false);
    setGenerationProgress(0);
    setCorridorBusy(false);
    setCorridorProgress(0);
    setSaveBusy(false);
    setSaveProgress(0);
    projectRef.current = next;
    setProject(next);
    setTargetElevation(Math.round(next.seaLevel + 180));
    setRules(defaultMaterialRules(next));
    setRulePreview(null);
    setColormapReview(null);
    setActiveLayerId('base');
    setActiveMaterialLayerId(null);
    setSelection(null);
    setSelectionDraft(null);
    setSelectionPolygonDraft([]);
    setSplinePoints([]);
    setHistory([]);
    setHistoryCursor(-1);
    forceRenderRevision();
    setDirty(false);
    clearRecoverySnapshot();
    nativeRecoveryRef.current = null;
    if (isTauriRuntime()) void clearNativeRecovery().catch(() => undefined);
    setRecoveryAvailable(false);
    setNativeProjectPath(null);
  }

  function confirmProjectReplacement(): boolean {
    if (!dirty) return true;
    const confirmed = window.confirm('This project has unsaved changes. Continue and keep a recovery snapshot?');
    if (!confirmed) return false;
    if (currentProject) {
      if (isTauriRuntime()) {
        void (async () => {
          try {
            const contents = JSON.stringify(await serializeProjectAsync(currentProject));
            await writeNativeRecovery(contents);
            nativeRecoveryRef.current = contents;
            setRecoveryAvailable(true);
          } catch { /* Recovery is best effort and must not block replacement. */ }
        })();
      } else {
        saveRecoverySnapshot(currentProject);
        setRecoveryAvailable(true);
      }
    }
    return true;
  }

  function newProject(): void {
    if (!confirmProjectReplacement()) return;
    saveAbortRef.current?.abort();
    setProject(null);
    projectRef.current = null;
    setDirty(false);
  }

  async function createProject(options: Parameters<typeof createTerrainProject>[0], onProgress?: (progress: number) => void): Promise<void> {
    try {
      const next = await createTerrainProjectAsync(options, onProgress);
      setCurrentProject(next);
      rememberProject(next);
      setRecentProjects(getRecentProjects());
      announce('Terrain project created');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not create this project');
    }
  }

  async function recoverProject(): Promise<void> {
    let recovered: TerrainProject | null = null;
    if (isTauriRuntime()) {
      const contents = nativeRecoveryRef.current ?? await readNativeRecovery().catch(() => null);
      if (contents) {
        try { recovered = deserializeProject(JSON.parse(contents)); } catch { recovered = null; }
      }
    } else {
      recovered = getRecoveryProject();
    }
    if (!recovered) { setRecoveryAvailable(false); announce('No recovery snapshot is available'); return; }
    setCurrentProject(recovered);
    rememberProject(recovered);
    setRecentProjects(getRecentProjects());
    announce(`Recovered ${recovered.name}`);
  }

  async function openProject(): Promise<void> {
    if (!confirmProjectReplacement()) return;
    if (isTauriRuntime()) {
      try {
        const selected = await openNativeProject();
        if (!selected) return;
        let next: TerrainProject;
        try { next = deserializeProject(JSON.parse(selected.contents)); } catch (error) { if (error instanceof SyntaxError) throw new Error('This file is not valid JSON.'); throw error; }
        setCurrentProject(next);
        setNativeProjectPath(selected.path);
        rememberProject(next);
        setRecentProjects(getRecentProjects());
        announce(`Opened ${next.name}`);
      } catch (error) { announce(error instanceof Error ? error.message : 'Could not open this project'); }
      return;
    }
    setOpenInputKey((value) => value + 1);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const next = await readProjectFile(file);
      setCurrentProject(next);
      rememberProject(next);
      setRecentProjects(getRecentProjects());
      announce(`Opened ${next.name}`);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not open this project');
    } finally {
      event.target.value = '';
    }
  }

  function chooseHeightmap(): void { heightmapInputRef.current?.click(); }
  function chooseColormap(): void { colormapInputRef.current?.click(); }

  async function handleHeightmap(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    const target = projectRef.current;
    if (!file || !target) return;
    if (!confirmProjectReplacement()) { event.target.value = ''; return; }
    try {
      const imported = await importHeightmapFile(file, target);
      setCurrentProject(imported);
      rememberProject(imported);
      setRecentProjects(getRecentProjects());
      announce(`Imported ${imported.width.toLocaleString()} × ${imported.height.toLocaleString()} heightmap`);
    } catch (error) { announce(error instanceof Error ? error.message : 'Could not import this heightmap'); }
    finally { event.target.value = ''; }
  }

  async function handleColormap(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    const target = projectRef.current;
    if (!file || !target) return;
    try {
      const review = await inspectColormapFile(file, target);
      setColormapReview({ file, ...review });
      announce(`Review ${review.mappings.length.toLocaleString()} detected colormap keys before import`);
    } catch (error) { announce(error instanceof Error ? error.message : 'Could not import this colormap'); }
    finally { event.target.value = ''; }
  }

  async function confirmColormapImport(): Promise<void> {
    const target = projectRef.current;
    if (!target || !colormapReview) return;
    setColormapBusy(true);
    try {
      const mapping = Object.fromEntries(colormapReview.mappings.map((entry) => [entry.key, entry.materialIndex]));
      const changes = await importColormapFile(colormapReview.file, target, mapping);
      target.colormapMappings = colormapReview.mappings.map((entry) => ({ key: entry.key, rgb: [...entry.rgb] as [number, number, number], count: entry.count, materialIndex: mapping[entry.key] ?? entry.materialIndex }));
      recordHistory('Colormap import', changes);
      if (!changes.length) { setDirty(true); scheduleRenderRevision(); }
      setColormapReview(null);
      announce(changes.length ? `Imported ${changes.length.toLocaleString()} material samples` : 'Colormap already matches the project');
    } catch (error) { announce(error instanceof Error ? error.message : 'Could not import this colormap'); }
    finally { setColormapBusy(false); }
  }

  async function saveProject(saveAs = false): Promise<void> {
    if (!currentProject || saveBusy) return;
    const target = currentProject;
    const saveRevision = revisionRef.current;
    const controller = new AbortController();
    saveAbortRef.current = controller;
    setSaveBusy(true);
    setSaveProgress(0);
    try {
      const onProgress = (progress: number) => setSaveProgress(progress * 0.9);
      if (isTauriRuntime()) {
        const contents = JSON.stringify(await serializeProjectAsync(target, onProgress, controller.signal));
        if (projectRef.current !== target) return;
        const path = !saveAs && nativeProjectPath ? (await writeNativeProject(contents, nativeProjectPath), nativeProjectPath) : await saveNativeProject(contents, projectFileName(target));
        if (!path) return;
        setNativeProjectPath(path);
      } else {
        await saveProjectDownloadAsync(target, onProgress, controller.signal);
      }
      setSaveProgress(1);
      if (revisionRef.current !== saveRevision) {
        setDirty(true);
        setRecentProjects(getRecentProjects());
        announce('Project saved; newer edits remain unsaved');
        return;
      }
      clearProjectDirtyTiles(target);
      clearRecoverySnapshot();
      nativeRecoveryRef.current = null;
      if (isTauriRuntime()) await clearNativeRecovery();
      setRecoveryAvailable(false);
      setDirty(false);
      setRecentProjects(getRecentProjects());
      announce(isTauriRuntime() ? (saveAs ? 'Project saved as a native file' : 'Project saved') : (saveAs ? 'Project download created' : 'Project saved locally'));
    } catch (error) { announce(error instanceof DOMException && error.name === 'AbortError' ? 'Save cancelled' : error instanceof Error ? `Save failed: ${error.message}` : 'Could not save this project'); }
    finally {
      if (saveAbortRef.current === controller) saveAbortRef.current = null;
      setSaveBusy(false);
      setSaveProgress(0);
    }
  }

  function cancelSave(): void { saveAbortRef.current?.abort(); }

  async function exportAssets(): Promise<void> {
    if (!currentProject) return;
    setExportBusy(true);
    try {
      await exportTerrainAssets(currentProject);
      setExportOpen(false);
      announce('Heightmap, colormap, and manifest exported');
    } catch (error) {
      announce(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed — check the project and try again');
    } finally { setExportBusy(false); }
  }

  function recordHistory(label: string, changes: EditChange[], preserveRenderPatch = false): void {
    if (!changes.length) return;
    const entry = { label, changes };
    setHistory((entries) => [...entries.slice(0, historyCursor + 1), entry]);
    setHistoryCursor((cursor) => cursor + 1);
    setDirty(true);
    if (!preserveRenderPatch) forceRenderRevision();
  }

  function startStroke(): void { strokeRef.current = new Map(); }

  function paintAt(point: { x: number; y: number }): void {
    const target = projectRef.current;
    if (!target || generating || rulesBusy || biomeBusy || corridorBusy || activeTool === 'select' || activeTool === 'road' || activeTool === 'river') return;
    const tool = activeTool === 'paint' ? 'paint' : activeTool === 'brush' ? 'raise' : activeTool;
    const changes = applyBrushStroke(target, { tool, centerX: point.x, centerY: point.y, radiusStuds: brushRadius, strength, hardness, targetElevation, stepHeightStuds, maxSlopeDegrees, noiseScaleStuds: noiseScale, activeLayerId, activeMaterialLayerId, maskMode, selection, materialIndex: selectedMaterial });
    for (const change of changes) {
      if (change.kind === 'material-bulk') continue;
      if (change.kind !== 'material' && change.kind !== 'mask' && change.kind !== 'material-layer' && change.kind !== 'height') continue;
      const key = change.kind === 'material' ? `m:${change.index}` : change.kind === 'mask' ? `mask:${change.index}` : change.kind === 'material-layer' ? `ml:${change.layerId}:${change.index}` : `h:${change.layerId}:${change.index}`;
      const existing = strokeRef.current.get(key);
      if (existing) existing.after = change.after;
      else strokeRef.current.set(key, { ...change });
    }
    if (changes.length) {
      setRulePreview(null);
      setDirty(true);
      scheduleRenderRevision(regionForChanges(target, changes));
    }
  }

  function endStroke(): void {
    const changes = Array.from(strokeRef.current.values());
    strokeRef.current.clear();
    recordHistory(brushToolLabels[activeTool], changes, true);
  }

  function samplePoint(point: { x: number; y: number }): void {
    if (!currentProject) return;
    setTargetElevation(Math.round(worldHeightFromNormalized(currentProject, compositeHeightAt(currentProject, point.x, point.y))));
    setActiveTool('flatten');
    announce(`Flatten target sampled at ${Math.round(worldHeightFromNormalized(currentProject, compositeHeightAt(currentProject, point.x, point.y))).toLocaleString()} studs`);
  }

  function selectionPoint(point: { x: number; y: number }): { x: number; y: number } {
    const target = projectRef.current;
    if (!target) return point;
    return { x: Math.max(0, Math.min(target.width - 1, point.x)), y: Math.max(0, Math.min(target.height - 1, point.y)) };
  }

  function beginSelection(point: { x: number; y: number }): void {
    const safe = selectionPoint(point);
    setSelectionDraft({ x0: safe.x, y0: safe.y, x1: safe.x, y1: safe.y });
  }

  function updateSelection(point: { x: number; y: number }): void {
    const safe = selectionPoint(point);
    setSelectionDraft((current) => current ? { ...current, x1: safe.x, y1: safe.y } : current);
  }

  function finishSelection(): void {
    if (!selectionDraft) return;
    const next = { x0: Math.round(Math.min(selectionDraft.x0, selectionDraft.x1)), y0: Math.round(Math.min(selectionDraft.y0, selectionDraft.y1)), x1: Math.round(Math.max(selectionDraft.x0, selectionDraft.x1)), y1: Math.round(Math.max(selectionDraft.y0, selectionDraft.y1)) };
    setSelection(next);
    setSelectionDraft(null);
    announce(`Selected ${Math.round(next.x1 - next.x0 + 1).toLocaleString()} × ${Math.round(next.y1 - next.y0 + 1).toLocaleString()} samples`);
  }

  function addSelectionPolygonPoint(point: { x: number; y: number }): void {
    const safe = selectionPoint(point);
    setSelectionPolygonDraft((current) => {
      const previous = current[current.length - 1];
      if (previous && Math.hypot(previous.x - safe.x, previous.y - safe.y) < 1) return current;
      return [...current, { x: Math.round(safe.x), y: Math.round(safe.y) }];
    });
  }

  function finishPolygonSelection(): void {
    if (selectionPolygonDraft.length < 3) {
      announce('Place at least three points to close a polygon selection');
      return;
    }
    setSelection({ kind: 'polygon', points: selectionPolygonDraft.map((point) => ({ ...point })) });
    setSelectionPolygonDraft([]);
    announce(`Polygon selection closed with ${selectionPolygonDraft.length} points`);
  }

  function clearSelection(): void {
    setSelection(null);
    setSelectionDraft(null);
    setSelectionPolygonDraft([]);
    announce('Selection cleared — edits apply to the full map');
  }

  function addSplinePoint(point: { x: number; y: number }): void {
    const safe = selectionPoint(point);
    setSplinePoints((current) => {
      const previous = current[current.length - 1];
      if (previous && Math.hypot(previous.x - safe.x, previous.y - safe.y) < 1) return current;
      return [...current, safe];
    });
  }

  function moveSplinePoint(index: number, point: { x: number; y: number }): void {
    const safe = selectionPoint(point);
    setSplinePoints((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? safe : candidate));
  }

  function clearSpline(): void {
    setSplinePoints([]);
    announce('Corridor path cleared');
  }

  function recallCorridor(corridor: CorridorRecord): void {
    setActiveTool(corridor.kind);
    setSplinePoints(corridor.points.map((point) => ({ ...point })));
    setCorridorWidth(corridor.widthStuds);
    setCorridorShoulder(corridor.shoulderWidthStuds);
    setCorridorDepth(corridor.depthStuds);
    setCorridorGrade(corridor.maxGradeDegrees);
    if (corridor.bedMaterialIndex !== undefined) setCorridorBedMaterial(corridor.bedMaterialIndex);
    if (corridor.bankMaterialIndex !== undefined) setCorridorBankMaterial(corridor.bankMaterialIndex);
    announce(`Recalled ${corridor.kind === 'road' ? 'road' : 'river'} path — edit points, then apply a new layer`);
  }

  async function applyCorridor(): Promise<void> {
    const target = projectRef.current;
    if (!target || (activeTool !== 'road' && activeTool !== 'river')) return;
    if (splinePoints.length < 2) {
      announce('Place at least two corridor points first');
      return;
    }
    const kind: CorridorKind = activeTool;
    const controller = new AbortController();
    corridorAbortRef.current = controller;
    setCorridorBusy(true);
    setCorridorProgress(0);
    try {
      const changes = await applyCorridorAsync(target, splinePoints, { kind, widthStuds: corridorWidth, shoulderWidthStuds: corridorShoulder, depthStuds: kind === 'river' ? corridorDepth : 0, maxGradeDegrees: corridorGrade, bedMaterialIndex: kind === 'river' ? corridorBedMaterial : undefined, bankMaterialIndex: kind === 'river' ? corridorBankMaterial : undefined, selection }, setCorridorProgress, controller.signal);
      if (projectRef.current !== target) return;
      setRulePreview(null);
      const layerChange = changes.find((change) => change.kind === 'height-layer');
      if (layerChange?.kind === 'height-layer') setActiveLayerId(layerChange.layerId);
      recordHistory(kind === 'road' ? 'Road corridor' : 'River channel', changes);
      setSplinePoints([]);
      announce(changes.length ? `${kind === 'road' ? 'Road corridor' : 'River channel'} added as a non-destructive layer` : 'Corridor made no editable changes');
    } catch (error) {
      announce(error instanceof DOMException && error.name === 'AbortError' ? 'Corridor application cancelled' : error instanceof Error ? error.message : 'Could not apply the corridor');
    } finally {
      if (corridorAbortRef.current === controller) corridorAbortRef.current = null;
      setCorridorBusy(false);
      setCorridorProgress(0);
    }
  }

  function cancelCorridor(): void { corridorAbortRef.current?.abort(); }

  function undo(): void {
    const entry = history[historyCursor];
    const target = projectRef.current;
    if (!entry || !target) return;
    applyChanges(target, entry.changes, 'before');
    setHistoryCursor((cursor) => cursor - 1);
    setDirty(true);
    forceRenderRevision();
    announce(`Undid ${entry.label.toLowerCase()}`);
  }

  function redo(): void {
    const entry = history[historyCursor + 1];
    const target = projectRef.current;
    if (!entry || !target) return;
    applyChanges(target, entry.changes, 'after');
    setHistoryCursor((cursor) => cursor + 1);
    setDirty(true);
    forceRenderRevision();
    announce(`Redid ${entry.label.toLowerCase()}`);
  }

  function updateLayer(layerId: string, updater: (layer: TerrainProject['layers'][number]) => void): void {
    const target = projectRef.current;
    if (!target) return;
    const layer = target.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    updater(layer);
    setRulePreview(null);
    target.updatedAt = new Date().toISOString();
    setDirty(true);
    forceRenderRevision();
  }

  function addLayer(): void {
    const target = projectRef.current;
    if (!target) return;
    const id = makeId('layer');
    target.layers.unshift({ id, name: `Height layer ${target.layers.length + 1}`, visible: true, opacity: 1, values: createFloat32TileBuffer(target.width, target.height) });
    setActiveLayerId(id);
    setRulePreview(null);
    setPanelTab('layers');
    setDirty(true);
    forceRenderRevision();
    announce('Height layer added');
  }

  function updateMaterialLayer(layerId: string, updater: (layer: MaterialLayer) => void): void {
    const target = projectRef.current;
    if (!target) return;
    const layer = target.materialLayers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    updater(layer);
    target.updatedAt = new Date().toISOString();
    setDirty(true);
    forceRenderRevision();
  }

  function selectMaterial(index: number): void {
    setSelectedMaterial(index);
    if (activeMaterialLayerId) updateMaterialLayer(activeMaterialLayerId, (layer) => { layer.materialIndex = index; });
  }

  function addMaterialLayer(): void {
    const target = projectRef.current;
    if (!target) return;
    const id = makeId('material-layer');
    target.materialLayers.unshift({ id, name: `${ROBLOX_MATERIALS[selectedMaterial].displayName} paint`, visible: true, opacity: 1, materialIndex: selectedMaterial, coverage: createFloat32TileBuffer(target.width, target.height) });
    setActiveMaterialLayerId(id);
    setPanelTab('materials');
    setDirty(true);
    forceRenderRevision();
    announce('Material layer added');
  }

  function deleteMaterialLayer(): void {
    const target = projectRef.current;
    if (!target || !activeMaterialLayerId) return;
    const index = target.materialLayers.findIndex((layer) => layer.id === activeMaterialLayerId);
    if (index < 0) return;
    target.materialLayers.splice(index, 1);
    setActiveMaterialLayerId(target.materialLayers[Math.max(0, index - 1)]?.id ?? null);
    setDirty(true);
    forceRenderRevision();
    announce('Material layer removed');
  }

  function moveMaterialLayer(direction: -1 | 1): void {
    const target = projectRef.current;
    if (!target || !activeMaterialLayerId) return;
    const index = target.materialLayers.findIndex((layer) => layer.id === activeMaterialLayerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= target.materialLayers.length) return;
    [target.materialLayers[index], target.materialLayers[nextIndex]] = [target.materialLayers[nextIndex], target.materialLayers[index]];
    setDirty(true);
    forceRenderRevision();
  }

  async function applyProceduralLayer(): Promise<void> {
    const target = projectRef.current;
    if (!target) return;
    const controller = new AbortController();
    generationAbortRef.current = controller;
    setGenerating(true);
    setGenerationProgress(0);
    try {
      const values = await runTerrainWorker('procedural', target, { procedural: { preset: proceduralPreset, seed: proceduralSeed, scaleStuds: proceduralScale, amplitudeStuds: proceduralAmplitude, edgeFalloff: proceduralEdgeFalloff, selection } }, setGenerationProgress, controller.signal);
      if (projectRef.current !== target) return;
      const id = makeId('procedural');
      const labels: Record<ProceduralPreset, string> = { 'rolling-hills': 'Rolling Hills', mountains: 'Mountains', plains: 'Plains', island: 'Island' };
      target.layers.unshift({ id, name: labels[proceduralPreset], visible: true, opacity: 1, values });
      setActiveLayerId(id);
      setRulePreview(null);
      setGenerateOpen(false);
      setPanelTab('layers');
      setDirty(true);
      forceRenderRevision();
      announce(`${labels[proceduralPreset]} added as a new layer`);
    } catch (error) {
      announce(error instanceof DOMException && error.name === 'AbortError' ? 'Terrain generation cancelled' : error instanceof Error ? error.message : 'Could not generate the terrain layer');
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setGenerating(false);
      setGenerationProgress(0);
    }
  }

  function cancelGeneration(): void { generationAbortRef.current?.abort(); }

  function deleteActiveLayer(): void {
    const target = projectRef.current;
    if (!target || activeLayerId === 'base') return;
    const index = target.layers.findIndex((layer) => layer.id === activeLayerId);
    if (index < 0) return;
    target.layers.splice(index, 1);
    setRulePreview(null);
    setActiveLayerId('base');
    setDirty(true);
    forceRenderRevision();
    announce('Height layer removed');
  }

  function moveLayer(direction: -1 | 1): void {
    const target = projectRef.current;
    if (!target || activeLayerId === 'base') return;
    const index = target.layers.findIndex((layer) => layer.id === activeLayerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= target.layers.length) return;
    [target.layers[index], target.layers[nextIndex]] = [target.layers[nextIndex], target.layers[index]];
    setRulePreview(null);
    setDirty(true);
    forceRenderRevision();
  }

  async function applyRules(): Promise<void> {
    const target = projectRef.current;
    if (!target) return;
    const controller = new AbortController();
    rulesAbortRef.current = controller;
    setRulesBusy(true);
    setRulesProgress(0);
    try {
      const preview = await runTerrainWorker('rules', target, { rules }, setRulesProgress, controller.signal);
      if (projectRef.current !== target) return;
      const changes = applyMaterialMap(target, preview);
      setRulePreview(null);
      recordHistory('Material rules', changes);
      announce(changes.length ? `Applied material rules as one compact undo step` : 'Rules made no changes');
    } catch (error) {
      announce(error instanceof DOMException && error.name === 'AbortError' ? 'Material rule application cancelled' : error instanceof Error ? error.message : 'Could not apply material rules');
    } finally {
      if (rulesAbortRef.current === controller) rulesAbortRef.current = null;
      setRulesBusy(false);
      setRulesProgress(0);
    }
  }

  async function previewRules(): Promise<void> {
    const target = projectRef.current;
    if (!target) return;
    const controller = new AbortController();
    rulesAbortRef.current = controller;
    setRulesBusy(true);
    setRulesProgress(0);
    try {
      const preview = await runTerrainWorker('rules', target, { rules }, setRulesProgress, controller.signal);
      if (projectRef.current !== target) return;
      setRulePreview(preview);
      setPanelTab('rules');
      announce('Rule preview shown — terrain data is unchanged');
    } catch (error) {
      announce(error instanceof DOMException && error.name === 'AbortError' ? 'Material rule preview cancelled' : error instanceof Error ? error.message : 'Could not preview material rules');
    } finally {
      if (rulesAbortRef.current === controller) rulesAbortRef.current = null;
      setRulesBusy(false);
      setRulesProgress(0);
    }
  }

  function cancelRules(): void { rulesAbortRef.current?.abort(); }

  async function applyBiome(): Promise<void> {
    const target = projectRef.current;
    if (!target) return;
    const biome = BIOME_PRESETS.find((candidate) => candidate.id === biomeId);
    const controller = new AbortController();
    biomeAbortRef.current = controller;
    setBiomeBusy(true);
    setBiomeProgress(0);
    try {
      const preview = await runTerrainWorker('biome', target, { biome: biomeId, selection }, setBiomeProgress, controller.signal);
      if (projectRef.current !== target) return;
      const changes = applyMaterialMap(target, preview);
      setRulePreview(null);
      recordHistory(`${biome?.name ?? 'Biome'} material pass`, changes);
      announce(changes.length ? `${biome?.name ?? 'Biome'} materials applied${selection ? ' to selection' : ''}` : 'Biome made no material changes');
    } catch (error) {
      announce(error instanceof DOMException && error.name === 'AbortError' ? 'Biome painting cancelled' : error instanceof Error ? error.message : 'Could not apply the biome');
    } finally {
      if (biomeAbortRef.current === controller) biomeAbortRef.current = null;
      setBiomeBusy(false);
      setBiomeProgress(0);
    }
  }

  function cancelBiome(): void { biomeAbortRef.current?.abort(); }

  if (!currentProject) return <><StartScreen onCreate={createProject} onOpen={openProject} onRecover={recoverProject} recoveryAvailable={recoveryAvailable} recentProjects={recentProjects} /><input key={openInputKey} ref={fileInputRef} type="file" accept=".rterrain,application/json" className="visually-hidden" onChange={handleFile} /></>;

  const totalWorldWidth = worldSizeForResolution(currentProject.width);
  const totalWorldDepth = worldSizeForResolution(currentProject.height);
  const activeMaterial = ROBLOX_MATERIALS[selectedMaterial];
  const canUndo = historyCursor >= 0;
  const canRedo = historyCursor < history.length - 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand"><span className="brand-mark small" aria-hidden="true"><i /><i /><i /></span><span>SOLUM</span><small>terrain studio</small></div>
        <div className="project-breadcrumb"><span className="crumb-muted">Projects</span><b>/</b><strong>{currentProject.name}</strong>{dirty && <span className="dirty-dot" title="Unsaved changes" />}</div>
        <div className="topbar-actions">
          <button className="top-action" onClick={newProject} title="New project (Ctrl N)">New</button>
          <button className="top-action" onClick={openProject} title="Open project (Ctrl O)">Open</button>
          <button className="top-action" disabled={saveBusy} onClick={() => saveProject()} title="Save project (Ctrl S)">{saveBusy ? 'Saving…' : 'Save'}</button>
          <button className="top-action" onClick={chooseHeightmap} title="Import a heightmap image">Import height</button>
          <button className="top-action" onClick={chooseColormap} title="Import a matching colormap image">Import color</button>
          <span className="top-divider" />
          <button className="icon-button" disabled={!canUndo} onClick={undo} title="Undo (Ctrl Z)">↶</button>
          <button className="icon-button" disabled={!canRedo} onClick={redo} title="Redo (Ctrl Y)">↷</button>
          <button className="export-button" onClick={() => setExportOpen(true)}>Export <span>⌄</span></button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="tool-rail">
          <div className="rail-section-label">Sculpt</div>
          {toolOrder.map((tool) => <button key={tool.id} className={`tool-button ${activeTool === tool.id ? 'active' : ''}`} onClick={() => { if ((tool.id === 'road' || tool.id === 'river') && tool.id !== activeTool) setSplinePoints([]); setActiveTool(tool.id); }} title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}><span className="tool-glyph">{tool.glyph}</span><span>{tool.label}</span>{tool.shortcut && <kbd>{tool.shortcut}</kbd>}</button>)}
          <div className="rail-spacer" />
          <div className="rail-section-label">Inspect</div>
          <button className={`tool-button ${viewMode === 'slope' ? 'active' : ''}`} onClick={() => { setViewMode('slope'); setPanelTab('inspector'); }} title="Slope analysis"><span className="tool-glyph">◒</span><span>Slope</span></button>
          <button className={`tool-button ${viewMode === 'mask' ? 'active' : ''}`} onClick={() => { setViewMode('mask'); setActiveTool('mask'); setPanelTab('inspector'); }} title="Protection mask"><span className="tool-glyph">◩</span><span>Mask</span></button>
          <button className="tool-button" onClick={() => setPanelTab('rules')} title="Material rules"><span className="tool-glyph">⌘</span><span>Rules</span></button>
          <div className="rail-footer"><span className="local-lock">⌂</span><small>local file</small></div>
        </aside>

        <section className="editor-column">
          <div className="editor-toolbar">
            <div className="view-switcher" aria-label="Viewport mode">
              {([['height', 'Height'], ['materials', 'Materials'], ['combined', 'Combined'], ['slope', 'Slope'], ['mask', 'Mask']] as Array<[ViewMode, string]>).map(([mode, label]) => <button key={mode} className={viewMode === mode ? 'selected' : ''} onClick={() => setViewMode(mode)}>{label}</button>)}
            </div>
            <div className="toolbar-context"><span className="context-dot" />{brushToolLabels[activeTool]}<span className="context-separator">·</span>{selection ? (isSelectionPolygon(selection) ? `${selection.points.length} point polygon selected` : `${Math.round(selection.x1 - selection.x0 + 1).toLocaleString()} × ${Math.round(selection.y1 - selection.y0 + 1).toLocaleString()} selected`) : formatStuds(brushRadius) + ' radius'}</div>
            <button className="fit-button" onClick={() => { setFitSignal((value) => value + 1); announce('Canvas fitted to terrain'); }}>Fit canvas <span>⌘⇧F</span></button>
          </div>
          <div className="canvas-panel">
            <TerrainViewport project={currentProject} revision={revision} dirtyRegion={dirtyRegion} viewMode={viewMode} brushRadiusStuds={brushRadius} fitSignal={fitSignal} materialOverride={rulePreview} isSpacePressed={isSpacePressed} onBrush={paintAt} onStrokeStart={startStroke} onStrokeEnd={endStroke} onSample={samplePoint} onPointerInfo={setPointer} selectionMode={activeTool === 'select'} selection={selection} selectionDraft={selectionDraft} selectionShape={selectionShape} selectionPolygonDraft={selectionPolygonDraft} onSelectionStart={beginSelection} onSelectionUpdate={updateSelection} onSelectionEnd={finishSelection} onPolygonPoint={addSelectionPolygonPoint} onPolygonFinish={finishPolygonSelection} splineMode={activeTool === 'road' || activeTool === 'river' ? activeTool : null} splinePoints={splinePoints} onSplinePoint={addSplinePoint} onSplinePointMove={moveSplinePoint} />
          </div>
          <div className="preview-panel">
            <div className="preview-head"><div><p className="eyebrow">Spatial check</p><h3>Live terrain preview</h3></div><div className="preview-meta"><span>WebGL 2</span><span>sampled {Math.min(72, Math.max(28, Math.round(Math.sqrt(Math.min(currentProject.width * currentProject.height, 5184)))))}² mesh</span></div></div>
            <TerrainPreview project={currentProject} revision={revision} materialOverride={rulePreview} />
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs">{([['inspector', 'Inspect'], ['layers', 'Layers'], ['materials', 'Materials'], ['rules', 'Rules']] as Array<[PanelTab, string]>).map(([tab, label]) => <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)}>{label}</button>)}</div>
          {panelTab === 'inspector' && <InspectorPanel project={currentProject} activeTool={activeTool} brushRadius={brushRadius} setBrushRadius={setBrushRadius} strength={strength} setStrength={setStrength} hardness={hardness} setHardness={setHardness} targetElevation={targetElevation} setTargetElevation={setTargetElevation} stepHeightStuds={stepHeightStuds} setStepHeightStuds={setStepHeightStuds} maxSlopeDegrees={maxSlopeDegrees} setMaxSlopeDegrees={setMaxSlopeDegrees} noiseScale={noiseScale} setNoiseScale={setNoiseScale} maskMode={maskMode} setMaskMode={setMaskMode} cursorStats={cursorStats} terrainStats={terrainStats} activeMaterial={activeMaterial} selection={selection} clearSelection={clearSelection} selectionShape={selectionShape} setSelectionShape={setSelectionShape} selectionPolygonDraft={selectionPolygonDraft} finishPolygonSelection={finishPolygonSelection} buildSlopeThreshold={buildSlopeThreshold} setBuildSlopeThreshold={setBuildSlopeThreshold} splinePoints={splinePoints} corridors={currentProject.corridors} onRecallCorridor={recallCorridor} corridorWidth={corridorWidth} setCorridorWidth={setCorridorWidth} corridorShoulder={corridorShoulder} setCorridorShoulder={setCorridorShoulder} corridorDepth={corridorDepth} setCorridorDepth={setCorridorDepth} corridorGrade={corridorGrade} setCorridorGrade={setCorridorGrade} corridorBedMaterial={corridorBedMaterial} setCorridorBedMaterial={setCorridorBedMaterial} corridorBankMaterial={corridorBankMaterial} setCorridorBankMaterial={setCorridorBankMaterial} corridorBusy={corridorBusy} corridorProgress={corridorProgress} cancelCorridor={cancelCorridor} clearSpline={clearSpline} applyCorridor={applyCorridor} />}
          {panelTab === 'layers' && <LayersPanel project={currentProject} activeLayerId={activeLayerId} setActiveLayerId={setActiveLayerId} currentLayer={currentLayer} updateLayer={updateLayer} addLayer={addLayer} deleteActiveLayer={deleteActiveLayer} moveLayer={moveLayer} generateOpen={generateOpen} setGenerateOpen={setGenerateOpen} proceduralPreset={proceduralPreset} setProceduralPreset={setProceduralPreset} proceduralSeed={proceduralSeed} setProceduralSeed={setProceduralSeed} proceduralScale={proceduralScale} setProceduralScale={setProceduralScale} proceduralAmplitude={proceduralAmplitude} setProceduralAmplitude={setProceduralAmplitude} proceduralEdgeFalloff={proceduralEdgeFalloff} setProceduralEdgeFalloff={setProceduralEdgeFalloff} applyProceduralLayer={applyProceduralLayer} generating={generating} generationProgress={generationProgress} cancelGeneration={cancelGeneration} />}
          {panelTab === 'materials' && <MaterialsPanel selectedMaterial={selectedMaterial} onSelectMaterial={selectMaterial} setSelectedMaterial={setSelectedMaterial} project={currentProject} revision={revision} activeMaterialLayerId={activeMaterialLayerId} setActiveMaterialLayerId={setActiveMaterialLayerId} addMaterialLayer={addMaterialLayer} updateMaterialLayer={updateMaterialLayer} deleteMaterialLayer={deleteMaterialLayer} moveMaterialLayer={moveMaterialLayer} biomeId={biomeId} setBiomeId={setBiomeId} applyBiome={applyBiome} biomeBusy={biomeBusy} biomeProgress={biomeProgress} cancelBiome={cancelBiome} selection={selection} />}
          {panelTab === 'rules' && <RulesPanel rules={rules} setRules={setRules} applyRules={applyRules} previewRules={previewRules} previewActive={Boolean(rulePreview)} busy={rulesBusy} progress={rulesProgress} cancel={cancelRules} />}
          <SavedCorridorsPanel corridors={currentProject.corridors} onRecall={recallCorridor} />
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-left"><span className="status-live" />{dirty ? 'Unsaved changes' : 'All changes saved'}<span className="status-separator" />{currentProject.width.toLocaleString()} × {currentProject.height.toLocaleString()} samples</div>
        {saveBusy && <div className="status-save" role="status" aria-live="polite"><span>Saving project</span><i><b style={{ width: `${Math.max(3, Math.round(saveProgress * 100))}%` }} /></i><button onClick={cancelSave}>Cancel</button></div>}
        <div className="status-center">{cursorStats ? <><span>X {cursorStats.x.toLocaleString()}</span><span>Z {cursorStats.z.toLocaleString()}</span><span>Elevation <b>{Math.round(cursorStats.elevation).toLocaleString()} studs</b></span><span>Slope <b>{cursorStats.slope.toFixed(1)}°</b></span></> : <span>Move over the terrain to inspect elevation and slope</span>}</div>
        <div className="status-right"><span>Sea level <b>{Math.round(currentProject.seaLevel).toLocaleString()} studs</b></span><span>{totalWorldWidth.toLocaleString()} × {totalWorldDepth.toLocaleString()} stud world</span></div>
      </footer>
      <input key={openInputKey} ref={fileInputRef} type="file" accept=".rterrain,application/json" className="visually-hidden" onChange={handleFile} />
      <input ref={heightmapInputRef} type="file" accept="image/png,image/jpeg" className="visually-hidden" onChange={handleHeightmap} />
      <input ref={colormapInputRef} type="file" accept="image/png,image/jpeg" className="visually-hidden" onChange={handleColormap} />
      {colormapReview && <ColormapDialog review={colormapReview} busy={colormapBusy} onClose={() => { if (!colormapBusy) setColormapReview(null); }} onConfirm={confirmColormapImport} onMaterialChange={(key, materialIndex) => setColormapReview((current) => current ? { ...current, mappings: current.mappings.map((entry) => entry.key === key ? { ...entry, materialIndex } : entry) } : current)} />}
      {exportOpen && <ExportDialog project={currentProject} onClose={() => { if (!exportBusy) setExportOpen(false); }} onExport={exportAssets} busy={exportBusy} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function InspectorPanel(props: {
  project: TerrainProject;
  activeTool: ToolId;
  brushRadius: number;
  setBrushRadius: (value: number) => void;
  strength: number;
  setStrength: (value: number) => void;
  hardness: number;
  setHardness: (value: number) => void;
  targetElevation: number;
  setTargetElevation: (value: number) => void;
  stepHeightStuds: number;
  setStepHeightStuds: (value: number) => void;
  maxSlopeDegrees: number;
  setMaxSlopeDegrees: (value: number) => void;
  noiseScale: number;
  setNoiseScale: (value: number) => void;
  maskMode: 'protect' | 'reveal';
  setMaskMode: (value: 'protect' | 'reveal') => void;
  cursorStats: { elevation: number; slope: number; x: number; z: number } | null;
  terrainStats: TerrainStatistics | null;
  activeMaterial: (typeof ROBLOX_MATERIALS)[number];
  selection: SelectionRegion | null;
  clearSelection: () => void;
  selectionShape: 'rectangle' | 'polygon';
  setSelectionShape: (value: 'rectangle' | 'polygon') => void;
  selectionPolygonDraft: CorridorPoint[];
  finishPolygonSelection: () => void;
  buildSlopeThreshold: number;
  setBuildSlopeThreshold: (value: number) => void;
  splinePoints: CorridorPoint[];
  corridors: CorridorRecord[];
  onRecallCorridor: (corridor: CorridorRecord) => void;
  corridorWidth: number;
  setCorridorWidth: (value: number) => void;
  corridorShoulder: number;
  setCorridorShoulder: (value: number) => void;
  corridorDepth: number;
  setCorridorDepth: (value: number) => void;
  corridorGrade: number;
  setCorridorGrade: (value: number) => void;
  corridorBedMaterial: number;
  setCorridorBedMaterial: (value: number) => void;
  corridorBankMaterial: number;
  setCorridorBankMaterial: (value: number) => void;
  corridorBusy: boolean;
  corridorProgress: number;
  cancelCorridor: () => void;
  clearSpline: () => void;
  applyCorridor: () => void;
}) {
  const { project, activeTool, brushRadius, setBrushRadius, strength, setStrength, hardness, setHardness, targetElevation, setTargetElevation, stepHeightStuds, setStepHeightStuds, maxSlopeDegrees, setMaxSlopeDegrees, noiseScale, setNoiseScale, maskMode, setMaskMode, cursorStats, terrainStats, activeMaterial, selection, clearSelection, selectionShape, setSelectionShape, selectionPolygonDraft, finishPolygonSelection, buildSlopeThreshold, setBuildSlopeThreshold, splinePoints, corridors, onRecallCorridor, corridorWidth, setCorridorWidth, corridorShoulder, setCorridorShoulder, corridorDepth, setCorridorDepth, corridorGrade, setCorridorGrade, corridorBedMaterial, setCorridorBedMaterial, corridorBankMaterial, setCorridorBankMaterial, corridorBusy, corridorProgress, cancelCorridor, clearSpline, applyCorridor } = props;
  return <div className="panel-scroll"><div className="panel-heading"><div><p className="eyebrow">Active tool</p><h2>{brushToolLabels[activeTool]}</h2></div><span className="tool-status">READY</span></div>
    {activeTool === 'select' && <div className="selection-card"><div className="property-label"><span>Selection shape</span><b>{selection ? 'ACTIVE' : selectionShape.toUpperCase()}</b></div><div className="segmented-control"><button className={selectionShape === 'rectangle' ? 'selected' : ''} onClick={() => setSelectionShape('rectangle')}>Rectangle</button><button className={selectionShape === 'polygon' ? 'selected' : ''} onClick={() => setSelectionShape('polygon')}>Polygon</button></div><p>{selection ? (isSelectionPolygon(selection) ? `${selection.points.length} point polygon selected.` : `${Math.round(selection.x1 - selection.x0 + 1).toLocaleString()} × ${Math.round(selection.y1 - selection.y0 + 1).toLocaleString()} samples selected.`) : selectionShape === 'polygon' ? 'Click points around an area, then click the first point or close the polygon below.' : 'Drag across the canvas to constrain height and material edits.'}</p>{selectionShape === 'polygon' && selectionPolygonDraft.length > 0 && <button className="secondary-action compact-action" onClick={finishPolygonSelection}>Close polygon ({selectionPolygonDraft.length} points)</button>}{selection && <button className="secondary-action compact-action" onClick={clearSelection}>Clear selection</button>}</div>}
    {(activeTool === 'road' || activeTool === 'river') && <div className="corridor-card"><div className="property-label"><span>Control points</span><b>{splinePoints.length}</b></div><p>{activeTool === 'road' ? 'Click points along a path. Apply creates a graded, blended non-destructive layer.' : 'Click points along a channel. Apply carves a blended river bed.'}</p><div className="property-group"><div className="property-label"><span>{activeTool === 'road' ? 'Road width' : 'River width'}</span><b>{corridorWidth} studs</b></div><input className="range-input" type="range" min="16" max="512" step="16" value={corridorWidth} disabled={corridorBusy} onChange={(event) => setCorridorWidth(Number(event.target.value))} /></div><div className="property-group"><div className="property-label"><span>Shoulder / bank</span><b>{corridorShoulder} studs</b></div><input className="range-input" type="range" min="0" max="512" step="16" value={corridorShoulder} disabled={corridorBusy} onChange={(event) => setCorridorShoulder(Number(event.target.value))} /></div>{activeTool === 'river' ? <><div className="property-group"><div className="property-label"><span>Channel depth</span><b>{corridorDepth} studs</b></div><input className="range-input" type="range" min="16" max="512" step="16" value={corridorDepth} disabled={corridorBusy} onChange={(event) => setCorridorDepth(Number(event.target.value))} /></div><label className="field-label compact-label">Bed material<select className="text-input" value={corridorBedMaterial} disabled={corridorBusy} onChange={(event) => setCorridorBedMaterial(Number(event.target.value))}>{ROBLOX_MATERIALS.map((material, index) => <option key={material.id} value={index}>{material.displayName}</option>)}</select></label><label className="field-label compact-label">Bank material<select className="text-input" value={corridorBankMaterial} disabled={corridorBusy} onChange={(event) => setCorridorBankMaterial(Number(event.target.value))}>{ROBLOX_MATERIALS.map((material, index) => <option key={material.id} value={index}>{material.displayName}</option>)}</select></label></> : <div className="property-group"><div className="property-label"><span>Preferred max grade</span><b>{corridorGrade}°</b></div><input className="range-input" type="range" min="4" max="30" step="1" value={corridorGrade} disabled={corridorBusy} onChange={(event) => setCorridorGrade(Number(event.target.value))} /></div>}{corridorBusy && <OperationProgress progress={corridorProgress} label={activeTool === 'road' ? 'Applying road corridor' : 'Applying river channel'} onCancel={cancelCorridor} />}<div className="layer-actions"><button onClick={clearSpline} disabled={corridorBusy}>Clear path</button><button className="small-primary" onClick={applyCorridor} disabled={corridorBusy || splinePoints.length < 2}>{corridorBusy ? 'Applying…' : activeTool === 'road' ? 'Apply road corridor' : 'Apply river channel'}</button></div>{selection && <small className="property-note">The active selection and protection mask constrain this corridor.</small>}</div>}
    <div className="property-group"><div className="property-label"><span>Brush radius</span><b>{brushRadius} studs</b></div><input className="range-input" type="range" min="16" max="2048" step="16" value={brushRadius} onChange={(event) => setBrushRadius(Number(event.target.value))} /><div className="range-ends"><span>16</span><span>2,048</span></div></div>
    <div className="property-group"><div className="property-label"><span>Strength</span><b>{Math.round(strength * 100)}%</b></div><input className="range-input" type="range" min="0.05" max="1" step="0.05" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /></div>
    <div className="property-group"><div className="property-label"><span>Edge hardness</span><b>{Math.round(hardness * 100)}%</b></div><input className="range-input" type="range" min="0" max="1" step="0.02" value={hardness} onChange={(event) => setHardness(Number(event.target.value))} /></div>
    {(activeTool === 'flatten' || activeTool === 'plateau') && <div className="property-group"><div className="property-label"><span>Target elevation</span><b>studs</b></div><input className="number-input" type="number" value={targetElevation} onChange={(event) => setTargetElevation(Number(event.target.value))} /><small className="property-note">Alt-click the canvas to sample a target.</small></div>}
    {activeTool === 'terrace' && <div className="property-group"><div className="property-label"><span>Step height</span><b>{stepHeightStuds} studs</b></div><input className="number-input" type="number" min="4" step="4" value={stepHeightStuds} onChange={(event) => setStepHeightStuds(Math.max(4, Number(event.target.value)))} /><small className="property-note">Quantizes the composed terrain into practical Roblox-sized levels.</small></div>}
    {activeTool === 'slope' && <div className="property-group"><div className="property-label"><span>Maximum local grade</span><b>{maxSlopeDegrees}°</b></div><input className="range-input" type="range" min="4" max="45" step="1" value={maxSlopeDegrees} onChange={(event) => setMaxSlopeDegrees(Number(event.target.value))} /><small className="property-note">Pulls over-grade samples toward their neighbors using 4-stud horizontal spacing.</small></div>}
    {activeTool === 'noise' && <div className="property-group"><div className="property-label"><span>Noise scale</span><b>{noiseScale} studs</b></div><input className="range-input" type="range" min="32" max="1200" step="16" value={noiseScale} onChange={(event) => setNoiseScale(Number(event.target.value))} /></div>}
    {activeTool === 'mask' && <div className="property-group"><div className="property-label"><span>Mask action</span><b>{maskMode === 'protect' ? 'protect' : 'reveal'}</b></div><div className="segmented-control"><button className={maskMode === 'protect' ? 'selected' : ''} onClick={() => setMaskMode('protect')}>Protect</button><button className={maskMode === 'reveal' ? 'selected' : ''} onClick={() => setMaskMode('reveal')}>Reveal</button></div><small className="property-note">Protected samples resist height and material edits. The mask is grayscale and saved with the project.</small></div>}
    <div className="property-divider" />
    <div className="property-group"><div className="property-label"><span>Active material</span><b>{activeMaterial.displayName}</b></div><div className="material-chip"><span style={{ background: activeMaterial.previewColor }} />{activeMaterial.enumName}<small>paint tool</small></div></div>
    <div className="property-divider" />
    <div className="panel-heading compact"><div><p className="eyebrow">Cursor readout</p><h3>{cursorStats ? `${Math.round(cursorStats.elevation).toLocaleString()} studs` : 'Move over terrain'}</h3></div>{cursorStats && <span className="slope-badge">{cursorStats.slope.toFixed(1)}° slope</span>}</div>
    <div className="readout-grid"><div><span>Project min</span><b>{formatStuds(project.minElevation)}</b></div><div><span>Project max</span><b>{formatStuds(project.maxElevation)}</b></div><div><span>Sea level</span><b>{formatStuds(project.seaLevel)}</b></div><div><span>Sample size</span><b>4 studs</b></div></div>
    {terrainStats && <div className="analysis-card"><div className="analysis-card-head"><span>Terrain analysis</span><small>{terrainStats.sampledPoints.toLocaleString()} samples observed</small></div><div className="property-group analysis-threshold"><div className="property-label"><span>Buildable slope aid</span><b>≤ {buildSlopeThreshold}°</b></div><input className="range-input" type="range" min="4" max="30" step="1" value={buildSlopeThreshold} onChange={(event) => setBuildSlopeThreshold(Number(event.target.value))} /></div><div className="analysis-metrics"><div><span>Observed range</span><b>{Math.round(terrainStats.maxElevation - terrainStats.minElevation)} studs</b></div><div><span>Mean elevation</span><b>{Math.round(terrainStats.meanElevation)} studs</b></div><div><span>Mean slope</span><b>{terrainStats.meanSlope.toFixed(1)}°</b></div><div><span>Steep area</span><b>{terrainStats.steepSamplePercent.toFixed(0)}%</b></div><div><span>Buildable area</span><b>{terrainStats.buildableSamplePercent.toFixed(0)}%</b></div><div><span>Below sea level</span><b>{terrainStats.waterCoveragePercent.toFixed(0)}%</b></div><div><span>Peak slope</span><b>{terrainStats.peakSlope.toFixed(1)}°</b></div></div><div className="coverage-row"><span>Material coverage</span><div>{terrainStats.materialCoverage.slice(0, 4).map((coverage) => <span key={coverage.materialIndex}><i style={{ background: ROBLOX_MATERIALS[coverage.materialIndex]?.previewColor }} />{ROBLOX_MATERIALS[coverage.materialIndex]?.displayName} {coverage.percent.toFixed(0)}%</span>)}</div></div></div>}
    <div className="info-callout"><span>i</span><p>Heights stay as normalized floats while you work. Grayscale is only created at export.</p></div>
  </div>;
}

function SavedCorridorsPanel({ corridors, onRecall }: { corridors: CorridorRecord[]; onRecall: (corridor: CorridorRecord) => void }) {
  if (!corridors.length) return null;
  return <div className="saved-corridors-panel"><div className="panel-heading compact"><div><p className="eyebrow">Persistent metadata</p><h3>Saved corridors</h3></div><span className="tool-status">{corridors.length}</span></div><p className="panel-copy">Applied paths are stored in the project. Recall one to refine its points and apply a new revision.</p>{corridors.slice(0, 8).map((corridor) => <button key={corridor.id} className="saved-corridor-row" onClick={() => onRecall(corridor)}><span className="saved-corridor-kind">{corridor.kind === 'road' ? 'Road' : 'River'}</span><span><strong>{corridor.points.length} control points</strong><small>{corridor.widthStuds} studs wide · {corridor.shoulderWidthStuds} studs blend</small></span><b>Recall</b></button>)}</div>;
}

function LayersPanel(props: { project: TerrainProject; activeLayerId: string; setActiveLayerId: (id: string) => void; currentLayer: TerrainProject['layers'][number] | undefined; updateLayer: (id: string, updater: (layer: TerrainProject['layers'][number]) => void) => void; addLayer: () => void; deleteActiveLayer: () => void; moveLayer: (direction: -1 | 1) => void; generateOpen: boolean; setGenerateOpen: (open: boolean) => void; proceduralPreset: ProceduralPreset; setProceduralPreset: (preset: ProceduralPreset) => void; proceduralSeed: number; setProceduralSeed: (value: number) => void; proceduralScale: number; setProceduralScale: (value: number) => void; proceduralAmplitude: number; setProceduralAmplitude: (value: number) => void; proceduralEdgeFalloff: number; setProceduralEdgeFalloff: (value: number) => void; applyProceduralLayer: () => void; generating: boolean; generationProgress: number; cancelGeneration: () => void }) {
  const { project, activeLayerId, setActiveLayerId, currentLayer, updateLayer, addLayer, deleteActiveLayer, moveLayer, generateOpen, setGenerateOpen, proceduralPreset, setProceduralPreset, proceduralSeed, setProceduralSeed, proceduralScale, setProceduralScale, proceduralAmplitude, setProceduralAmplitude, proceduralEdgeFalloff, setProceduralEdgeFalloff, applyProceduralLayer, generating, generationProgress, cancelGeneration } = props;
  return <div className="panel-scroll"><div className="panel-heading"><div><p className="eyebrow">Composition</p><h2>Height layers</h2></div><div className="panel-heading-actions"><button className="small-secondary" onClick={() => setGenerateOpen(!generateOpen)}>{generateOpen ? 'Close' : 'Generate'}</button><button className="small-primary" onClick={addLayer}>＋ Layer</button></div></div><p className="panel-copy">Base height is absolute. Added layers store signed deltas, so experiments stay reversible and composable.</p>
    {generateOpen && <GeneratePanel proceduralPreset={proceduralPreset} setProceduralPreset={setProceduralPreset} proceduralSeed={proceduralSeed} setProceduralSeed={setProceduralSeed} proceduralScale={proceduralScale} setProceduralScale={setProceduralScale} proceduralAmplitude={proceduralAmplitude} setProceduralAmplitude={setProceduralAmplitude} proceduralEdgeFalloff={proceduralEdgeFalloff} setProceduralEdgeFalloff={setProceduralEdgeFalloff} applyProceduralLayer={applyProceduralLayer} generating={generating} progress={generationProgress} cancel={cancelGeneration} />}
    <div className="layer-list"><button className={`layer-row ${activeLayerId === 'base' ? 'selected' : ''}`} onClick={() => setActiveLayerId('base')}><span className="layer-icon base-icon">◎</span><span><strong>Base terrain</strong><small>absolute height field</small></span><span className="layer-eye">◉</span></button>{project.layers.map((layer) => <button className={`layer-row ${activeLayerId === layer.id ? 'selected' : ''}`} key={layer.id} onClick={() => setActiveLayerId(layer.id)}><span className="layer-icon">≋</span><span><strong>{layer.name}</strong><small>{Math.round(layer.opacity * 100)}% intensity</small></span><span className="layer-eye" onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, (current) => { current.visible = !current.visible; }); }}>{layer.visible ? '◉' : '○'}</span></button>)}</div>
    {currentLayer && <div className="layer-properties"><div className="property-label"><span>Layer name</span><b>delta</b></div><input className="text-input" value={currentLayer.name} onChange={(event) => updateLayer(currentLayer.id, (layer) => { layer.name = event.target.value; })} /><div className="property-label"><span>Opacity</span><b>{Math.round(currentLayer.opacity * 100)}%</b></div><input className="range-input" type="range" min="0" max="1" step="0.05" value={currentLayer.opacity} onChange={(event) => updateLayer(currentLayer.id, (layer) => { layer.opacity = Number(event.target.value); })} /><div className="layer-actions"><button onClick={() => moveLayer(-1)}>↑ Move up</button><button onClick={() => moveLayer(1)}>↓ Move down</button><button className="danger-button" onClick={deleteActiveLayer}>Delete</button></div></div>}
    <div className="info-callout"><span>↳</span><p>Layer edits feed the same composed height field used by export, slope, rules, and the 3D preview.</p></div>
  </div>;
}

function GeneratePanel(props: { proceduralPreset: ProceduralPreset; setProceduralPreset: (preset: ProceduralPreset) => void; proceduralSeed: number; setProceduralSeed: (value: number) => void; proceduralScale: number; setProceduralScale: (value: number) => void; proceduralAmplitude: number; setProceduralAmplitude: (value: number) => void; proceduralEdgeFalloff: number; setProceduralEdgeFalloff: (value: number) => void; applyProceduralLayer: () => void; generating: boolean; progress: number; cancel: () => void }) {
  const { proceduralPreset, setProceduralPreset, proceduralSeed, setProceduralSeed, proceduralScale, setProceduralScale, proceduralAmplitude, setProceduralAmplitude, proceduralEdgeFalloff, setProceduralEdgeFalloff, applyProceduralLayer, generating, progress, cancel } = props;
  return <div className="generate-panel"><div className="generate-title"><span className="generate-glyph">∿</span><div><strong>Procedural layer</strong><small>{generating ? 'Computing off the UI thread…' : 'Safe by default · creates a new delta layer'}</small></div></div><label className="field-label compact-label">Preset<select className="text-input" value={proceduralPreset} disabled={generating} onChange={(event) => setProceduralPreset(event.target.value as ProceduralPreset)}><option value="rolling-hills">Rolling Hills</option><option value="mountains">Mountains</option><option value="plains">Plains</option><option value="island">Island</option></select></label><div className="generate-grid"><label className="field-label compact-label">Seed<input className="number-input" type="number" value={proceduralSeed} disabled={generating} onChange={(event) => setProceduralSeed(Number(event.target.value))} /></label><label className="field-label compact-label">Scale<input className="number-input" type="number" min="32" value={proceduralScale} disabled={generating} onChange={(event) => setProceduralScale(Math.max(32, Number(event.target.value)))} /><span className="field-help">studs</span></label></div><div className="property-group"><div className="property-label"><span>Amplitude</span><b>{proceduralAmplitude} studs</b></div><input className="range-input" type="range" min="64" max="1024" step="16" value={proceduralAmplitude} disabled={generating} onChange={(event) => setProceduralAmplitude(Number(event.target.value))} /></div>{proceduralPreset === 'island' && <div className="property-group"><div className="property-label"><span>Edge falloff</span><b>{proceduralEdgeFalloff.toFixed(1)}</b></div><input className="range-input" type="range" min="0.5" max="2.5" step="0.1" value={proceduralEdgeFalloff} disabled={generating} onChange={(event) => setProceduralEdgeFalloff(Number(event.target.value))} /></div>}{generating && <OperationProgress progress={progress} label="Generating terrain" onCancel={cancel} />}<button className="generate-action" disabled={generating} onClick={applyProceduralLayer}>{generating ? 'Generating…' : 'Add generated layer'} <span>↗</span></button></div>;
}

function MaterialsPanel(props: { selectedMaterial: number; onSelectMaterial: (index: number) => void; setSelectedMaterial: (index: number) => void; project: TerrainProject; revision: number; activeMaterialLayerId: string | null; setActiveMaterialLayerId: (id: string | null) => void; addMaterialLayer: () => void; updateMaterialLayer: (id: string, updater: (layer: MaterialLayer) => void) => void; deleteMaterialLayer: () => void; moveMaterialLayer: (direction: -1 | 1) => void; biomeId: BiomeId; setBiomeId: (id: BiomeId) => void; applyBiome: () => void; biomeBusy: boolean; biomeProgress: number; cancelBiome: () => void; selection: SelectionRegion | null }) {
  const { selectedMaterial, onSelectMaterial, setSelectedMaterial, project, revision, activeMaterialLayerId, setActiveMaterialLayerId, addMaterialLayer, updateMaterialLayer, deleteMaterialLayer, moveMaterialLayer, biomeId, setBiomeId, applyBiome, biomeBusy, biomeProgress, cancelBiome, selection } = props;
  const counts = useMemo(() => { const result = new Map<number, number>(); for (let index = 0; index < project.materials.length; index += 1) { const material = materialAt(project, index); result.set(material, (result.get(material) ?? 0) + 1); } return result; }, [project, revision]);
  const activeLayer = project.materialLayers.find((layer) => layer.id === activeMaterialLayerId) ?? null;
  const selectedBiome = BIOME_PRESETS.find((biome) => biome.id === biomeId) ?? BIOME_PRESETS[0];
  return <div className="panel-scroll">
    <div className="panel-heading"><div><p className="eyebrow">Roblox palette</p><h2>Materials</h2></div><span className="material-count">{ROBLOX_MATERIALS.length} mapped</span></div>
    <p className="panel-copy">Paint stable Roblox material identities. Export colors are only a colormap representation.</p>
    <div className="materials-grid">{ROBLOX_MATERIALS.map((material, index) => <button key={material.id} className={`material-swatch ${selectedMaterial === index ? 'selected' : ''}`} onClick={() => onSelectMaterial(index)}><span style={{ background: material.previewColor }} /><strong>{material.displayName}</strong><small>{((counts.get(index) ?? 0) / Math.max(1, project.materials.length) * 100).toFixed(0)}%</small></button>)}</div>
    <div className="material-tip"><span style={{ background: ROBLOX_MATERIALS[selectedMaterial].previewColor }} />Selected: <b>{ROBLOX_MATERIALS[selectedMaterial].enumName}</b><small>Choose Material paint to apply with the brush.</small></div>
    <div className="biome-panel"><div className="biome-panel-head"><strong>Biome paint</strong><small>deterministic distribution</small></div><select className="text-input" value={biomeId} disabled={biomeBusy} onChange={(event) => setBiomeId(event.target.value as BiomeId)}>{BIOME_PRESETS.map((biome) => <option key={biome.id} value={biome.id}>{biome.name}</option>)}</select><small className="biome-panel-note">{selectedBiome.description} {selection ? 'The active selection will change.' : 'The full material map will change.'}</small>{biomeBusy && <OperationProgress progress={biomeProgress} label="Painting biome" onCancel={cancelBiome} />}<button className="generate-action" disabled={biomeBusy} onClick={applyBiome}>{biomeBusy ? 'Painting biome…' : selection ? 'Paint selected area' : 'Paint full material map'} <span>◒</span></button></div>
    <div className="material-layer-heading"><div><p className="eyebrow">Non-destructive paint</p><h3>Material layers</h3></div><button className="small-primary" onClick={addMaterialLayer}>＋ Layer</button></div>
    <p className="panel-copy">A layer paints one material with coverage. Top layers override the base map when visible.</p>
    <div className="material-layer-list">{project.materialLayers.map((layer) => <button key={layer.id} className={`material-layer-row ${activeMaterialLayerId === layer.id ? 'selected' : ''}`} onClick={() => { setActiveMaterialLayerId(layer.id); setSelectedMaterial(layer.materialIndex); }}><span className="layer-icon" style={{ color: ROBLOX_MATERIALS[layer.materialIndex].previewColor }}>◒</span><span><strong>{layer.name}</strong><small>{ROBLOX_MATERIALS[layer.materialIndex].displayName} · {Math.round(layer.opacity * 100)}%</small></span><span className="layer-eye" onClick={(event) => { event.stopPropagation(); updateMaterialLayer(layer.id, (current) => { current.visible = !current.visible; }); }}>{layer.visible ? '◉' : '○'}</span></button>)}</div>
    {activeLayer && <div className="layer-properties"><div className="property-label"><span>Layer name</span><b>coverage</b></div><input className="text-input" value={activeLayer.name} onChange={(event) => updateMaterialLayer(activeLayer.id, (layer) => { layer.name = event.target.value; })} /><div className="property-label"><span>Opacity</span><b>{Math.round(activeLayer.opacity * 100)}%</b></div><input className="range-input" type="range" min="0" max="1" step="0.05" value={activeLayer.opacity} onChange={(event) => updateMaterialLayer(activeLayer.id, (layer) => { layer.opacity = Number(event.target.value); })} /><div className="layer-actions"><button onClick={() => moveMaterialLayer(-1)}>↑ Move up</button><button onClick={() => moveMaterialLayer(1)}>↓ Move down</button><button className="danger-button" onClick={deleteMaterialLayer}>Delete</button></div></div>}
  </div>;
}

function RulesPanel(props: { rules: MaterialRule[]; setRules: (rules: MaterialRule[]) => void; applyRules: () => void; previewRules: () => void; previewActive: boolean; busy: boolean; progress: number; cancel: () => void }) {
  const { rules, setRules, applyRules, previewRules, previewActive, busy, progress, cancel } = props;
  return <div className="panel-scroll"><div className="panel-heading"><div><p className="eyebrow">Deterministic assignment</p><h2>Material rules</h2></div><div className="panel-heading-actions"><button className={`small-secondary ${previewActive ? 'preview-active' : ''}`} disabled={busy} onClick={previewRules}>{busy ? 'Working…' : previewActive ? 'Previewing' : 'Preview'}</button><button className="small-primary" disabled={busy} onClick={applyRules}>{busy ? 'Working…' : 'Apply'}</button></div></div><p className="panel-copy">Rules resolve top to bottom. Elevation and slope use the composed terrain, with the project seed keeping noise repeatable. Large maps compute in a background worker and apply as one compact undo step.</p>{busy && <OperationProgress progress={progress} label="Evaluating material rules" onCancel={cancel} />}<div className="rule-list">{rules.map((rule, index) => <div className={`rule-row ${rule.enabled ? '' : 'disabled'}`} key={rule.id}><button className="rule-toggle" disabled={busy} onClick={() => setRules(rules.map((current) => current.id === rule.id ? { ...current, enabled: !current.enabled } : current))}>{rule.enabled ? '✓' : '·'}</button><div className="rule-main"><div className="rule-title"><span className="rule-color" style={{ background: ROBLOX_MATERIALS[rule.materialIndex].previewColor }} /><strong>{rule.name}</strong><small>priority {index + 1}</small></div><div className="rule-conditions"><span>{rule.minElevation === null ? 'any' : `≥ ${Math.round(rule.minElevation)} elevation`}</span><span>{rule.minSlope === null ? 'any slope' : `≥ ${Math.round(rule.minSlope)}° slope`}</span></div></div></div>)}</div><div className="info-callout"><span>!</span><p>Preview is transient and feeds both views. Apply commits the map change as one undoable edit.</p></div></div>;
}

function OperationProgress(props: { progress: number; label: string; onCancel: () => void }) {
  const { progress, label, onCancel } = props;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return <div className="operation-progress" role="status" aria-live="polite"><div className="operation-progress-head"><span>{label}</span><b>{percent}%</b></div><div className="operation-progress-track"><i style={{ width: `${Math.max(3, percent)}%` }} /></div><button className="operation-cancel" onClick={onCancel}>Cancel</button></div>;
}

function ColormapDialog(props: { review: { file: File; mappings: ColormapColorMapping[]; truncated: boolean }; busy: boolean; onClose: () => void; onConfirm: () => Promise<void>; onMaterialChange: (key: string, materialIndex: number) => void }) {
  const { review, busy, onClose, onConfirm, onMaterialChange } = props;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="export-dialog colormap-dialog" role="dialog" aria-modal="true" aria-labelledby="colormap-title">
      <div className="modal-heading"><div><p className="eyebrow">Material handoff</p><h2 id="colormap-title">Review colormap keys</h2></div><button className="quiet-icon" disabled={busy} onClick={onClose} aria-label="Close colormap review">×</button></div>
      <p className="modal-copy">Solum found {review.mappings.length.toLocaleString()} distinct RGB keys in <strong>{review.file.name}</strong>. Confirm or correct their Roblox material identities before importing.</p>
      {review.truncated && <div className="export-note"><span>!</span><p>More than 64 unique colors were detected. Unlisted colors will use the nearest export key; reduce the source palette for a fully explicit mapping.</p></div>}
      <div className="colormap-list">{review.mappings.map((entry) => <div className="colormap-row" key={entry.key}><span className="colormap-swatch" style={{ background: `rgb(${entry.rgb.join(',')})` }} /><span className="colormap-rgb">RGB {entry.rgb.join(', ')}</span><small>{entry.count.toLocaleString()} samples</small><select className="text-input" value={entry.materialIndex} disabled={busy} onChange={(event) => onMaterialChange(entry.key, Number(event.target.value))}>{ROBLOX_MATERIALS.map((material, index) => <option key={material.id} value={index}>{material.displayName}</option>)}</select></div>)}</div>
      <div className="modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-action" disabled={busy} onClick={onConfirm}>{busy ? 'Importing…' : 'Import mapped colormap'} <b>↗</b></button></div>
    </section>
  </div>;
}

function ExportDialog(props: { project: TerrainProject; onClose: () => void; onExport: () => Promise<void>; busy: boolean }) {
  const { project, onClose, onExport, busy } = props;
  const worldWidth = worldSizeForResolution(project.width);
  const worldDepth = worldSizeForResolution(project.height);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal-heading"><div><p className="eyebrow">Roblox handoff</p><h2 id="export-title">Export terrain package</h2></div><button className="quiet-icon" onClick={onClose} aria-label="Close export dialog">×</button></div>
      <p className="modal-copy">Review the resolved dimensions and elevation mapping before creating the conservative PNG + manifest package for Roblox Studio.</p>
      <div className="export-summary">
        <div><span>Project size</span><b>{project.width.toLocaleString()} × {project.height.toLocaleString()} px</b></div>
        <div><span>World size</span><b>{worldWidth.toLocaleString()} × {worldDepth.toLocaleString()} studs</b></div>
        <div><span>Elevation</span><b>{Math.round(project.minElevation).toLocaleString()} → {Math.round(project.maxElevation).toLocaleString()} studs</b></div>
        <div><span>Vertical range</span><b>{Math.round(project.maxElevation - project.minElevation).toLocaleString()} studs</b></div>
        <div><span>Height mapping</span><b>1 pixel = 4 studs</b></div>
        <div><span>Sea level</span><b>{Math.round(project.seaLevel).toLocaleString()} studs</b></div>
      </div>
      <div className="export-files"><div><span className="file-icon">↳</span><div><strong>{projectFileStem(project)}-heightmap.png</strong><small>8-bit grayscale export of composed height</small></div></div><div><span className="file-icon">◒</span><div><strong>{projectFileStem(project)}-colormap.png</strong><small>Deterministic RGB keys for material identity</small></div></div><div><span className="file-icon">≡</span><div><strong>{projectFileStem(project)}-manifest.json</strong><small>Mapping, scale, source project, and export metadata</small></div></div></div>
      <div className="export-note"><span>!</span><p>PNG files are output representations only. Solum keeps normalized float heights internally and records the RGB → Roblox material mapping in the manifest.</p></div>
      <div className="modal-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-action" disabled={busy} onClick={onExport}>{busy ? 'Exporting…' : 'Create export package'} <b>↗</b></button></div>
    </section>
  </div>;
}

function projectFileStem(project: Pick<TerrainProject, 'name'>): string {
  return project.name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').slice(0, 72) || 'untitled-terrain';
}
