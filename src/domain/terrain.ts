import { MATERIAL_INDEX_BY_ID, ROBLOX_MATERIALS, ROBLOX_TERRAIN } from './roblox';
import { ByteTileBuffer, cloneFloatBuffer, createFloat32TileBuffer, createUint8TileBuffer, FloatTileBuffer, toFloat32Array } from './tileBuffer';

export type StartingTerrain = 'flat' | 'gentle-noise' | 'empty';
export type ProceduralPreset = 'rolling-hills' | 'mountains' | 'plains' | 'island';
export type BiomeId = 'temperate' | 'alpine' | 'desert';
export type CorridorKind = 'road' | 'river';
export type ToolId = 'brush' | 'select' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'terrace' | 'ridge' | 'valley' | 'plateau' | 'slope' | 'paint' | 'road' | 'river' | 'mask';
export type ViewMode = 'height' | 'materials' | 'combined' | 'slope' | 'mask';

export type SelectionRect = { x0: number; y0: number; x1: number; y1: number };
export type CorridorPoint = { x: number; y: number };
export type SelectionPolygon = { kind: 'polygon'; points: CorridorPoint[] };
export type SelectionRegion = SelectionRect | SelectionPolygon;
export type ColormapMapping = { key: string; rgb: [number, number, number]; count: number; materialIndex: number };

export function isSelectionPolygon(selection: SelectionRegion): selection is SelectionPolygon {
  return (selection as SelectionPolygon).kind === 'polygon';
}
export type CorridorRecord = {
  id: string;
  kind: CorridorKind;
  points: CorridorPoint[];
  widthStuds: number;
  shoulderWidthStuds: number;
  depthStuds: number;
  maxGradeDegrees: number;
  bedMaterialIndex?: number;
  bankMaterialIndex?: number;
};

export type BiomePreset = {
  id: BiomeId;
  name: string;
  description: string;
};

export const BIOME_PRESETS: BiomePreset[] = [
  { id: 'temperate', name: 'Temperate', description: 'Grass, leafy clearings, ground, mud, and rock.' },
  { id: 'alpine', name: 'Alpine', description: 'Rock and slate slopes with high-elevation snow.' },
  { id: 'desert', name: 'Desert', description: 'Sand flats, sandstone shelves, and exposed rock.' },
];

export type HeightLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  values: FloatTileBuffer;
};

export type MaterialLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  materialIndex: number;
  coverage: FloatTileBuffer;
};

export type TerrainProject = {
  schemaVersion: 1;
  name: string;
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  seaLevel: number;
  seed: number;
  base: FloatTileBuffer;
  layers: HeightLayer[];
  materials: ByteTileBuffer;
  materialLayers: MaterialLayer[];
  mask: FloatTileBuffer;
  corridors: CorridorRecord[];
  colormapMappings: ColormapMapping[];
  updatedAt: string;
};

export type BrushOptions = {
  tool: Exclude<ToolId, 'brush'>;
  centerX: number;
  centerY: number;
  radiusStuds: number;
  strength: number;
  hardness: number;
  targetElevation: number;
  stepHeightStuds?: number;
  noiseScaleStuds: number;
  maxSlopeDegrees?: number;
  activeLayerId: string;
  activeMaterialLayerId?: string | null;
  maskMode?: 'protect' | 'reveal';
  selection?: SelectionRegion | null;
  materialIndex: number;
};

export type CorridorOptions = {
  kind: CorridorKind;
  widthStuds: number;
  shoulderWidthStuds: number;
  depthStuds: number;
  maxGradeDegrees: number;
  bedMaterialIndex?: number;
  bankMaterialIndex?: number;
  selection?: SelectionRegion | null;
};

export type EditChange =
  | { kind: 'height'; layerId: string; index: number; before: number; after: number }
  | { kind: 'height-layer'; layerId: string; index: number; before: HeightLayer | null; after: HeightLayer | null }
  | { kind: 'material'; index: number; before: number; after: number }
  | { kind: 'material-layer'; layerId: string; index: number; before: number; after: number }
  | { kind: 'material-layer-structure'; layerId: string; index: number; before: MaterialLayer | null; after: MaterialLayer | null }
  | { kind: 'corridor-structure'; corridorId: string; index: number; before: CorridorRecord | null; after: CorridorRecord | null }
  | { kind: 'mask'; index: number; before: number; after: number }
  | { kind: 'material-bulk'; before: Uint8Array; after: Uint8Array };

export type MaterialRule = {
  id: string;
  name: string;
  enabled: boolean;
  materialIndex: number;
  minElevation: number | null;
  maxElevation: number | null;
  minSlope: number | null;
  maxSlope: number | null;
  noiseAmount: number;
  noiseScaleStuds: number;
  priority: number;
};

export type TerrainStatistics = {
  minElevation: number;
  maxElevation: number;
  meanElevation: number;
  meanSlope: number;
  peakSlope: number;
  steepSamplePercent: number;
  buildableSamplePercent: number;
  buildabilityThreshold: number;
  waterCoveragePercent: number;
  materialCoverage: Array<{ materialIndex: number; percent: number }>;
  sampledPoints: number;
};

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function resolutionForWorldSize(studs: number): number {
  if (!Number.isFinite(studs) || studs <= 0 || studs % ROBLOX_TERRAIN.studsPerSample !== 0) {
    throw new Error('World size must be a positive multiple of 4 studs.');
  }
  return studs / ROBLOX_TERRAIN.studsPerSample;
}

export function worldSizeForResolution(samples: number): number {
  return samples * ROBLOX_TERRAIN.studsPerSample;
}

export function normalizeSelectionRect(selection: SelectionRect): SelectionRect {
  return {
    x0: Math.min(selection.x0, selection.x1),
    y0: Math.min(selection.y0, selection.y1),
    x1: Math.max(selection.x0, selection.x1),
    y1: Math.max(selection.y0, selection.y1),
  };
}

export function selectionBounds(selection: SelectionRegion): SelectionRect {
  if (isSelectionPolygon(selection)) {
    const xs = selection.points.map((point) => point.x);
    const ys = selection.points.map((point) => point.y);
    return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  return normalizeSelectionRect(selection);
}

export function normalizeSelectionRegion(selection: SelectionRegion): SelectionRegion {
  if (isSelectionPolygon(selection)) return { kind: 'polygon', points: selection.points.map((point) => ({ x: point.x, y: point.y })) };
  return normalizeSelectionRect(selection);
}

export function selectionContains(selection: SelectionRegion, x: number, y: number): boolean {
  if (isSelectionPolygon(selection)) {
    if (selection.points.length < 3) return false;
    let inside = false;
    for (let index = 0, previous = selection.points.length - 1; index < selection.points.length; previous = index++) {
      const current = selection.points[index];
      const prior = selection.points[previous];
      const intersects = (current.y > y) !== (prior.y > y) && x < (prior.x - current.x) * (y - current.y) / (prior.y - current.y) + current.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }
  const x0 = Math.min(selection.x0, selection.x1);
  const y0 = Math.min(selection.y0, selection.y1);
  const x1 = Math.max(selection.x0, selection.x1);
  const y1 = Math.max(selection.y0, selection.y1);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export function normalizedFromWorldHeight(project: Pick<TerrainProject, 'minElevation' | 'maxElevation'>, elevation: number): number {
  const range = project.maxElevation - project.minElevation;
  if (range <= 0) return 0;
  return clamp((elevation - project.minElevation) / range);
}

export function worldHeightFromNormalized(project: Pick<TerrainProject, 'minElevation' | 'maxElevation'>, normalized: number): number {
  return project.minElevation + clamp(normalized) * (project.maxElevation - project.minElevation);
}

function hash2d(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight === 0 ? 0 : total / weight;
}

function newLayer(id: string, name: string, width: number, height: number): HeightLayer {
  return { id, name, visible: true, opacity: 1, values: createFloat32TileBuffer(width, height) };
}

export type TerrainProjectOptions = {
  name: string;
  worldWidth: number;
  worldDepth: number;
  minElevation: number;
  maxElevation: number;
  seaLevel: number;
  seed: number;
  startingTerrain: StartingTerrain;
};

export function createTerrainProject(options: TerrainProjectOptions): TerrainProject {
  const width = resolutionForWorldSize(options.worldWidth);
  const height = resolutionForWorldSize(options.worldDepth);
  if (width > ROBLOX_TERRAIN.maxHeightmapWidth || height > ROBLOX_TERRAIN.maxHeightmapHeight) {
    throw new Error(`Roblox heightmaps are limited to ${ROBLOX_TERRAIN.maxHeightmapWidth} × ${ROBLOX_TERRAIN.maxHeightmapHeight} samples.`);
  }
  if (options.maxElevation <= options.minElevation) throw new Error('Maximum elevation must be higher than minimum elevation.');
  const base = createFloat32TileBuffer(width, height);
  const materials = createUint8TileBuffer(width, height);
  const project: TerrainProject = {
    schemaVersion: 1,
    name: options.name.trim() || 'Untitled terrain',
    width,
    height,
    minElevation: options.minElevation,
    maxElevation: options.maxElevation,
    seaLevel: options.seaLevel,
    seed: options.seed,
    base,
    layers: [],
    materials,
    materialLayers: [],
    mask: createFloat32TileBuffer(width, height, 1),
    corridors: [],
    colormapMappings: [],
    updatedAt: new Date().toISOString(),
  };
  if (options.startingTerrain === 'gentle-noise') {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        base[y * width + x] = 0.25 + fbm(x / 42, y / 42, options.seed, 4) * 0.35;
      }
    }
  }
  if (options.startingTerrain === 'empty') base.fill(0.08);
  return project;
}

export async function createTerrainProjectAsync(options: TerrainProjectOptions, onProgress?: (progress: number) => void): Promise<TerrainProject> {
  const project = createTerrainProject({ ...options, startingTerrain: options.startingTerrain === 'gentle-noise' ? 'flat' : options.startingTerrain });
  if (options.startingTerrain !== 'gentle-noise') return project;
  for (let y = 0; y < project.height; y += 1) {
    for (let x = 0; x < project.width; x += 1) project.base[y * project.width + x] = 0.25 + fbm(x / 42, y / 42, options.seed, 4) * 0.35;
    if (y % 24 === 0 || y === project.height - 1) {
      onProgress?.((y + 1) / project.height);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  return project;
}

function layerFor(project: TerrainProject, layerId: string): HeightLayer | null {
  return project.layers.find((layer) => layer.id === layerId) ?? null;
}

function materialLayerFor(project: TerrainProject, layerId: string | null | undefined): MaterialLayer | null {
  if (!layerId) return null;
  return project.materialLayers.find((layer) => layer.id === layerId) ?? null;
}

export function materialAt(project: TerrainProject, index: number): number {
  for (const layer of project.materialLayers) {
    if (layer.visible && layer.opacity > 0 && layer.coverage[index] * layer.opacity >= 0.5) return layer.materialIndex;
  }
  return project.materials[index] ?? 0;
}

function indexAt(project: TerrainProject, x: number, y: number): number {
  const safeX = Math.max(0, Math.min(project.width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(project.height - 1, Math.round(y)));
  return safeY * project.width + safeX;
}

function composedValueAt(project: TerrainProject, composed: Float32Array, x: number, y: number): number {
  return composed[indexAt(project, x, y)];
}

export function compositeHeightAt(project: TerrainProject, x: number, y: number): number {
  const index = indexAt(project, x, y);
  let value = project.base[index];
  for (const layer of project.layers) {
    if (layer.visible) value += layer.values[index] * layer.opacity;
  }
  return clamp(value);
}

export function compositeHeights(project: TerrainProject): Float32Array {
  const composed = toFloat32Array(project.base);
  for (const layer of project.layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    for (let index = 0; index < composed.length; index += 1) composed[index] = clamp(composed[index] + layer.values[index] * layer.opacity);
  }
  return composed;
}

export function slopeDegreesAt(project: TerrainProject, x: number, y: number): number {
  const left = worldHeightFromNormalized(project, compositeHeightAt(project, x - 1, y));
  const right = worldHeightFromNormalized(project, compositeHeightAt(project, x + 1, y));
  const top = worldHeightFromNormalized(project, compositeHeightAt(project, x, y - 1));
  const bottom = worldHeightFromNormalized(project, compositeHeightAt(project, x, y + 1));
  const dx = (right - left) / (2 * ROBLOX_TERRAIN.studsPerSample);
  const dz = (bottom - top) / (2 * ROBLOX_TERRAIN.studsPerSample);
  return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI);
}

function slopeDegreesFromComposed(project: TerrainProject, composed: Float32Array, x: number, y: number): number {
  const left = worldHeightFromNormalized(project, composedValueAt(project, composed, x - 1, y));
  const right = worldHeightFromNormalized(project, composedValueAt(project, composed, x + 1, y));
  const top = worldHeightFromNormalized(project, composedValueAt(project, composed, x, y - 1));
  const bottom = worldHeightFromNormalized(project, composedValueAt(project, composed, x, y + 1));
  const dx = (right - left) / (2 * ROBLOX_TERRAIN.studsPerSample);
  const dz = (bottom - top) / (2 * ROBLOX_TERRAIN.studsPerSample);
  return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI);
}

export function terrainStatistics(project: TerrainProject, buildabilityThreshold = 12): TerrainStatistics {
  const stride = Math.max(1, Math.ceil(Math.sqrt((project.width * project.height) / 20000)));
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  let elevationTotal = 0;
  let slopeTotal = 0;
  let peakSlope = 0;
  let steepSamples = 0;
  let buildableSamples = 0;
  let waterSamples = 0;
  const materialSamples = new Uint32Array(ROBLOX_MATERIALS.length);
  let sampledPoints = 0;
  for (let y = 0; y < project.height; y += stride) {
    for (let x = 0; x < project.width; x += stride) {
      const elevation = worldHeightFromNormalized(project, compositeHeightAt(project, x, y));
      const slope = slopeDegreesAt(project, x, y);
      const materialIndex = materialAt(project, indexAt(project, x, y));
      materialSamples[materialIndex] += 1;
      if (elevation <= project.seaLevel) waterSamples += 1;
      minElevation = Math.min(minElevation, elevation);
      maxElevation = Math.max(maxElevation, elevation);
      elevationTotal += elevation;
      slopeTotal += slope;
      peakSlope = Math.max(peakSlope, slope);
      if (slope >= 35) steepSamples += 1;
      if (slope <= buildabilityThreshold) buildableSamples += 1;
      sampledPoints += 1;
    }
  }
  return {
    minElevation,
    maxElevation,
    meanElevation: sampledPoints ? elevationTotal / sampledPoints : 0,
    meanSlope: sampledPoints ? slopeTotal / sampledPoints : 0,
    peakSlope,
    steepSamplePercent: sampledPoints ? steepSamples / sampledPoints * 100 : 0,
    buildableSamplePercent: sampledPoints ? buildableSamples / sampledPoints * 100 : 0,
    buildabilityThreshold,
    waterCoveragePercent: sampledPoints ? waterSamples / sampledPoints * 100 : 0,
    materialCoverage: Array.from(materialSamples, (count, materialIndex) => ({ materialIndex, percent: sampledPoints ? count / sampledPoints * 100 : 0 })).filter((entry) => entry.percent > 0).sort((a, b) => b.percent - a.percent),
    sampledPoints,
  };
}

function applyStorageDelta(project: TerrainProject, layerId: string, index: number, visibleDelta: number): EditChange | null {
  if (layerId === 'base') {
    const before = project.base[index];
    const after = clamp(before + visibleDelta);
    if (Math.abs(after - before) < 0.000001) return null;
    project.base[index] = after;
    return { kind: 'height', layerId, index, before, after };
  }
  const layer = layerFor(project, layerId);
  if (!layer) return null;
  const before = layer.values[index];
  const after = Math.max(-1, Math.min(1, before + visibleDelta / Math.max(layer.opacity, 0.001)));
  if (Math.abs(after - before) < 0.000001) return null;
  layer.values[index] = after;
  return { kind: 'height', layerId, index, before, after };
}

export function applyBrushStroke(project: TerrainProject, options: BrushOptions): EditChange[] {
  const radius = Math.max(1, options.radiusStuds / ROBLOX_TERRAIN.studsPerSample);
  const minX = Math.max(0, Math.floor(options.centerX - radius));
  const maxX = Math.min(project.width - 1, Math.ceil(options.centerX + radius));
  const minY = Math.max(0, Math.floor(options.centerY - radius));
  const maxY = Math.min(project.height - 1, Math.ceil(options.centerY + radius));
  const selection = options.selection ? normalizeSelectionRegion(options.selection) : null;
  const changes: EditChange[] = [];
  const strength = clamp(options.strength);
  const normalizedTarget = normalizedFromWorldHeight(project, options.targetElevation);
  const noiseScale = Math.max(1, options.noiseScaleStuds / ROBLOX_TERRAIN.studsPerSample);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.sqrt((x - options.centerX) ** 2 + (y - options.centerY) ** 2);
      if (distance > radius) continue;
      if (selection && !selectionContains(selection, x, y)) continue;
      const normalizedDistance = 1 - distance / radius;
      const falloff = clamp(options.hardness + (1 - options.hardness) * normalizedDistance * normalizedDistance);
      const index = y * project.width + x;
      const maskFactor = project.mask[index] ?? 1;
      if (options.tool === 'mask') {
        const before = project.mask[index];
        const amount = falloff * strength;
        const after = clamp(before + (options.maskMode === 'reveal' ? amount : -amount));
        if (Math.abs(after - before) >= 0.000001) {
          project.mask[index] = after;
          changes.push({ kind: 'mask', index, before, after });
        }
        continue;
      }
      if (options.tool === 'paint') {
        if (falloff * strength < 0.06) continue;
        const materialLayer = materialLayerFor(project, options.activeMaterialLayerId);
        if (materialLayer) {
          const before = materialLayer.coverage[index];
          const after = clamp(Math.max(before, falloff * strength * maskFactor));
          if (after !== before) {
            materialLayer.coverage[index] = after;
            changes.push({ kind: 'material-layer', layerId: materialLayer.id, index, before, after });
          }
          continue;
        }
        const before = project.materials[index];
        if (before !== options.materialIndex) {
          project.materials[index] = options.materialIndex;
          changes.push({ kind: 'material', index, before, after: options.materialIndex });
        }
        continue;
      }

      const current = compositeHeightAt(project, x, y);
      let visibleDelta = 0;
      if (options.tool === 'raise') visibleDelta = 0.018 * strength * falloff;
      if (options.tool === 'lower') visibleDelta = -0.018 * strength * falloff;
      if (options.tool === 'noise') visibleDelta = (fbm(x / noiseScale, y / noiseScale, project.seed, 4) - 0.5) * 0.16 * strength * falloff;
      if (options.tool === 'flatten') visibleDelta = (normalizedTarget - current) * strength * falloff;
      if (options.tool === 'terrace') {
        const step = Math.max(4, options.stepHeightStuds ?? 64) / Math.max(1, project.maxElevation - project.minElevation);
        const terraced = Math.round(current / step) * step;
        visibleDelta = (terraced - current) * strength * falloff;
      }
      if (options.tool === 'ridge' || options.tool === 'valley') {
        const axial = Math.max(0, 1 - Math.abs(y - options.centerY) / radius);
        const elongated = Math.exp(-(((x - options.centerX) / Math.max(1, radius * 0.34)) ** 2)) * (0.55 + axial * 0.45);
        const sign = options.tool === 'ridge' ? 1 : -1;
        visibleDelta = sign * 0.024 * strength * falloff * elongated;
      }
      if (options.tool === 'plateau') {
        const plateauFalloff = clamp((falloff - 0.18) / 0.82);
        visibleDelta = (normalizedTarget - current) * strength * plateauFalloff;
      }
      if (options.tool === 'slope') {
        const maximumSlope = Math.max(1, Math.min(89, options.maxSlopeDegrees ?? 12));
        const maximumDelta = Math.tan(maximumSlope * Math.PI / 180) * ROBLOX_TERRAIN.studsPerSample / Math.max(1, project.maxElevation - project.minElevation);
        let correctionTotal = 0;
        let correctionCount = 0;
        for (const [offsetX, offsetY] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const neighbor = compositeHeightAt(project, x + offsetX, y + offsetY);
          const difference = neighbor - current;
          if (difference > maximumDelta) {
            correctionTotal += neighbor - maximumDelta;
            correctionCount += 1;
          } else if (difference < -maximumDelta) {
            correctionTotal += neighbor + maximumDelta;
            correctionCount += 1;
          }
        }
        if (correctionCount > 0) visibleDelta = (correctionTotal / correctionCount - current) * strength * falloff;
      }
      if (options.tool === 'smooth') {
        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            sum += compositeHeightAt(project, x + ox, y + oy);
            count += 1;
          }
        }
        visibleDelta = ((sum / count) - current) * 0.35 * strength * falloff;
      }
      visibleDelta *= maskFactor;
      const change = applyStorageDelta(project, options.activeLayerId, index, visibleDelta);
      if (change) changes.push(change);
    }
  }
  if (changes.length > 0) project.updatedAt = new Date().toISOString();
  return changes;
}

export function applyChanges(project: TerrainProject, changes: EditChange[], direction: 'before' | 'after'): void {
  for (const change of changes) {
    if (change.kind === 'height-layer') {
      const snapshot = direction === 'before' ? change.before : change.after;
      const existingIndex = project.layers.findIndex((layer) => layer.id === change.layerId);
      if (!snapshot) {
        if (existingIndex >= 0) project.layers.splice(existingIndex, 1);
      } else {
        const restored = { ...snapshot, values: cloneFloatBuffer(snapshot.values) };
        if (existingIndex >= 0) project.layers[existingIndex] = restored;
        else project.layers.splice(Math.max(0, Math.min(change.index, project.layers.length)), 0, restored);
      }
      continue;
    }
    if (change.kind === 'material-layer-structure') {
      const snapshot = direction === 'before' ? change.before : change.after;
      const existingIndex = project.materialLayers.findIndex((layer) => layer.id === change.layerId);
      if (!snapshot) {
        if (existingIndex >= 0) project.materialLayers.splice(existingIndex, 1);
      } else {
        const restored = { ...snapshot, coverage: cloneFloatBuffer(snapshot.coverage) };
        if (existingIndex >= 0) project.materialLayers[existingIndex] = restored;
        else project.materialLayers.splice(Math.max(0, Math.min(change.index, project.materialLayers.length)), 0, restored);
      }
      continue;
    }
    if (change.kind === 'corridor-structure') {
      const snapshot = direction === 'before' ? change.before : change.after;
      const existingIndex = project.corridors.findIndex((corridor) => corridor.id === change.corridorId);
      if (!snapshot) {
        if (existingIndex >= 0) project.corridors.splice(existingIndex, 1);
      } else {
        const restored = { ...snapshot, points: snapshot.points.map((point) => ({ ...point })) };
        if (existingIndex >= 0) project.corridors[existingIndex] = restored;
        else project.corridors.splice(Math.max(0, Math.min(change.index, project.corridors.length)), 0, restored);
      }
      continue;
    }
    if (change.kind === 'material-bulk') {
      project.materials.set(direction === 'before' ? change.before : change.after);
      continue;
    }
    const value = direction === 'before' ? change.before : change.after;
    if (change.kind === 'material') project.materials[change.index] = value;
    else if (change.kind === 'mask') project.mask[change.index] = value;
    else if (change.kind === 'material-layer') {
      const layer = materialLayerFor(project, change.layerId);
      if (layer) layer.coverage[change.index] = value;
    } else if (change.layerId === 'base') project.base[change.index] = value;
    else {
      const layer = layerFor(project, change.layerId);
      if (layer) layer.values[change.index] = value;
    }
  }
  if (changes.length > 0) project.updatedAt = new Date().toISOString();
}

export function evaluateMaterialRules(project: TerrainProject, rules: MaterialRule[]): EditChange[] {
  const preview = materialMapForRules(project, rules);
  const changes: EditChange[] = [];
  for (let index = 0; index < project.materials.length; index += 1) {
    const before = project.materials[index];
    const after = preview[index];
    if (before !== after) {
      project.materials[index] = after;
      changes.push({ kind: 'material', index, before, after });
    }
  }
  if (changes.length > 0) project.updatedAt = new Date().toISOString();
  return changes;
}

export function materialMapForRules(project: TerrainProject, rules: MaterialRule[]): Uint8Array {
  const result = new Uint8Array(project.materials.length);
  for (let index = 0; index < result.length; index += 1) result[index] = materialAt(project, index);
  const composed = compositeHeights(project);
  const sorted = rules.filter((rule) => rule.enabled).sort((a, b) => a.priority - b.priority);
  for (let y = 0; y < project.height; y += 1) {
    for (let x = 0; x < project.width; x += 1) {
      const index = y * project.width + x;
      if ((project.mask[index] ?? 1) <= 0) {
        result[index] = project.materials[index];
        continue;
      }
      const elevation = worldHeightFromNormalized(project, composedValueAt(project, composed, x, y));
      const slope = slopeDegreesFromComposed(project, composed, x, y);
      let materialIndex: number | null = null;
      for (const rule of sorted) {
        const inElevation = (rule.minElevation === null || elevation >= rule.minElevation) && (rule.maxElevation === null || elevation <= rule.maxElevation);
        const inSlope = (rule.minSlope === null || slope >= rule.minSlope) && (rule.maxSlope === null || slope <= rule.maxSlope);
        const noisePass = rule.noiseAmount <= 0 || fbm(x / Math.max(1, rule.noiseScaleStuds / 4), y / Math.max(1, rule.noiseScaleStuds / 4), project.seed + rule.priority, 3) >= rule.noiseAmount;
        if (inElevation && inSlope && noisePass) {
          materialIndex = rule.materialIndex;
          break;
        }
      }
      if (materialIndex !== null) result[index] = materialIndex;
    }
  }
  return result;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Terrain operation cancelled.', 'AbortError');
}

async function yieldTerrainWork(): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function materialMapForRulesAsync(project: TerrainProject, rules: MaterialRule[], onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const result = new Uint8Array(project.materials.length);
  for (let index = 0; index < result.length; index += 1) result[index] = materialAt(project, index);
  const composed = new Float32Array(project.base.length);
  const sorted = rules.filter((rule) => rule.enabled).sort((a, b) => a.priority - b.priority);
  const batchRows = 24;
  for (let y = 0; y < project.height; y += 1) {
    checkCancelled(signal);
    for (let x = 0; x < project.width; x += 1) {
      const index = y * project.width + x;
      let value = project.base[index];
      for (const layer of project.layers) if (layer.visible && layer.opacity !== 0) value = clamp(value + layer.values[index] * layer.opacity);
      composed[index] = value;
    }
    if (y % batchRows === batchRows - 1 || y === project.height - 1) {
      onProgress?.(((y + 1) / project.height) * 0.45);
      await yieldTerrainWork();
    }
  }
  for (let y = 0; y < project.height; y += 1) {
    checkCancelled(signal);
    for (let x = 0; x < project.width; x += 1) {
      const index = y * project.width + x;
      if ((project.mask[index] ?? 1) <= 0) {
        result[index] = project.materials[index];
        continue;
      }
      const elevation = worldHeightFromNormalized(project, composedValueAt(project, composed, x, y));
      const slope = slopeDegreesFromComposed(project, composed, x, y);
      for (const rule of sorted) {
        const inElevation = (rule.minElevation === null || elevation >= rule.minElevation) && (rule.maxElevation === null || elevation <= rule.maxElevation);
        const inSlope = (rule.minSlope === null || slope >= rule.minSlope) && (rule.maxSlope === null || slope <= rule.maxSlope);
        const noisePass = rule.noiseAmount <= 0 || fbm(x / Math.max(1, rule.noiseScaleStuds / 4), y / Math.max(1, rule.noiseScaleStuds / 4), project.seed + rule.priority, 3) >= rule.noiseAmount;
        if (inElevation && inSlope && noisePass) {
          result[index] = rule.materialIndex;
          break;
        }
      }
    }
    if (y % batchRows === batchRows - 1 || y === project.height - 1) {
      onProgress?.(0.45 + ((y + 1) / project.height) * 0.55);
      await yieldTerrainWork();
    }
  }
  onProgress?.(1);
  return result;
}

export async function evaluateMaterialRulesAsync(project: TerrainProject, rules: MaterialRule[], onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<EditChange[]> {
  const preview = await materialMapForRulesAsync(project, rules, onProgress, signal);
  let changed = false;
  for (let index = 0; index < project.materials.length; index += 1) {
    if (project.materials[index] !== preview[index]) { changed = true; break; }
  }
  if (!changed) return [];
  const before = new Uint8Array(project.materials);
  project.materials.set(preview);
  project.updatedAt = new Date().toISOString();
  return [{ kind: 'material-bulk', before, after: new Uint8Array(preview) }];
}

type WeightedMaterial = { materialIndex: number; weight: number };

function weightedMaterial(weights: WeightedMaterial[], sample: number): number {
  const total = weights.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return weights[0]?.materialIndex ?? 0;
  let cursor = clamp(sample, 0, 0.999999) * total;
  for (const entry of weights) {
    cursor -= Math.max(0, entry.weight);
    if (cursor <= 0) return entry.materialIndex;
  }
  return weights[weights.length - 1]?.materialIndex ?? 0;
}

function biomeMaterialAt(project: TerrainProject, biome: BiomeId, x: number, y: number, elevation: number, slope: number): number {
  const normalizedElevation = normalizedFromWorldHeight(project, elevation);
  const variation = fbm(x / 18, y / 18, project.seed + biome.length * 97, 3);
  if (biome === 'temperate') {
    if (slope >= 42) return MATERIAL_INDEX_BY_ID.rock;
    if (normalizedElevation <= 0.16) return variation > 0.52 ? MATERIAL_INDEX_BY_ID.mud : MATERIAL_INDEX_BY_ID.ground;
    return weightedMaterial([
      { materialIndex: MATERIAL_INDEX_BY_ID.grass, weight: 0.42 },
      { materialIndex: MATERIAL_INDEX_BY_ID['leafy-grass'], weight: 0.28 },
      { materialIndex: MATERIAL_INDEX_BY_ID.ground, weight: normalizedElevation > 0.62 ? 0.2 : 0.14 },
      { materialIndex: MATERIAL_INDEX_BY_ID.mud, weight: 0.08 },
      { materialIndex: MATERIAL_INDEX_BY_ID.rock, weight: slope / 100 },
    ], variation);
  }
  if (biome === 'alpine') {
    if (normalizedElevation >= 0.78 && variation > 0.2) return MATERIAL_INDEX_BY_ID.snow;
    if (slope >= 38) return variation > 0.45 ? MATERIAL_INDEX_BY_ID.rock : MATERIAL_INDEX_BY_ID.slate;
    return weightedMaterial([
      { materialIndex: MATERIAL_INDEX_BY_ID.grass, weight: 0.28 },
      { materialIndex: MATERIAL_INDEX_BY_ID.rock, weight: 0.3 },
      { materialIndex: MATERIAL_INDEX_BY_ID.slate, weight: 0.18 },
      { materialIndex: MATERIAL_INDEX_BY_ID.snow, weight: normalizedElevation * 0.35 },
    ], variation);
  }
  if (slope >= 48) return MATERIAL_INDEX_BY_ID.rock;
  if (normalizedElevation <= 0.28) return MATERIAL_INDEX_BY_ID.sand;
  if (normalizedElevation >= 0.72) return variation > 0.48 ? MATERIAL_INDEX_BY_ID.sandstone : MATERIAL_INDEX_BY_ID.rock;
  return weightedMaterial([
    { materialIndex: MATERIAL_INDEX_BY_ID.sand, weight: 0.46 },
    { materialIndex: MATERIAL_INDEX_BY_ID.sandstone, weight: 0.3 },
    { materialIndex: MATERIAL_INDEX_BY_ID.ground, weight: 0.12 },
    { materialIndex: MATERIAL_INDEX_BY_ID.rock, weight: slope / 90 },
  ], variation);
}

export function materialMapForBiome(project: TerrainProject, biome: BiomeId, selection?: SelectionRegion | null): Uint8Array {
  const result = new Uint8Array(project.materials);
  const composed = compositeHeights(project);
  const normalizedSelection = selection ? normalizeSelectionRegion(selection) : null;
  for (let y = 0; y < project.height; y += 1) {
    for (let x = 0; x < project.width; x += 1) {
      if (normalizedSelection && !selectionContains(normalizedSelection, x, y)) continue;
      const index = y * project.width + x;
      if ((project.mask[index] ?? 1) <= 0) continue;
      const elevation = worldHeightFromNormalized(project, composedValueAt(project, composed, x, y));
      result[index] = biomeMaterialAt(project, biome, x, y, elevation, slopeDegreesFromComposed(project, composed, x, y));
    }
  }
  return result;
}

export async function materialMapForBiomeAsync(project: TerrainProject, biome: BiomeId, selection?: SelectionRegion | null, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const result = new Uint8Array(project.materials);
  const composed = new Float32Array(project.base.length);
  const normalizedSelection = selection ? normalizeSelectionRegion(selection) : null;
  const batchRows = 24;
  for (let y = 0; y < project.height; y += 1) {
    checkCancelled(signal);
    for (let x = 0; x < project.width; x += 1) {
      const index = y * project.width + x;
      let value = project.base[index];
      for (const layer of project.layers) if (layer.visible && layer.opacity !== 0) value = clamp(value + layer.values[index] * layer.opacity);
      composed[index] = value;
    }
    if (y % batchRows === batchRows - 1 || y === project.height - 1) {
      onProgress?.(((y + 1) / project.height) * 0.4);
      await yieldTerrainWork();
    }
  }
  for (let y = 0; y < project.height; y += 1) {
    checkCancelled(signal);
    for (let x = 0; x < project.width; x += 1) {
      if (normalizedSelection && !selectionContains(normalizedSelection, x, y)) continue;
      const index = y * project.width + x;
      if ((project.mask[index] ?? 1) <= 0) continue;
      const elevation = worldHeightFromNormalized(project, composedValueAt(project, composed, x, y));
      result[index] = biomeMaterialAt(project, biome, x, y, elevation, slopeDegreesFromComposed(project, composed, x, y));
    }
    if (y % batchRows === batchRows - 1 || y === project.height - 1) {
      onProgress?.(0.4 + ((y + 1) / project.height) * 0.6);
      await yieldTerrainWork();
    }
  }
  onProgress?.(1);
  return result;
}

export function applyMaterialMap(project: TerrainProject, next: Uint8Array): EditChange[] {
  if (next.length !== project.materials.length) throw new Error('The material result does not match the project dimensions.');
  let changed = false;
  for (let index = 0; index < project.materials.length; index += 1) {
    if (project.materials[index] !== next[index]) { changed = true; break; }
  }
  if (!changed) return [];
  const before = new Uint8Array(project.materials);
  project.materials.set(next);
  project.updatedAt = new Date().toISOString();
  return [{ kind: 'material-bulk', before, after: new Uint8Array(next) }];
}

export async function applyBiomeAsync(project: TerrainProject, biome: BiomeId, selection?: SelectionRegion | null, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<EditChange[]> {
  const preview = await materialMapForBiomeAsync(project, biome, selection, onProgress, signal);
  return applyMaterialMap(project, preview);
}

function nearestPointOnSegment(x: number, y: number, start: CorridorPoint, end: CorridorPoint): { distance: number; t: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 0.000001 ? 0 : clamp(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared, 0, 1);
  const nearestX = start.x + dx * t;
  const nearestY = start.y + dy * t;
  return { distance: Math.sqrt((x - nearestX) ** 2 + (y - nearestY) ** 2), t };
}

export async function applyCorridorAsync(project: TerrainProject, points: CorridorPoint[], options: CorridorOptions, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<EditChange[]> {
  if (points.length < 2) throw new Error('A corridor needs at least two control points.');
  const path = points.map((point) => ({ x: Math.max(0, Math.min(project.width - 1, point.x)), y: Math.max(0, Math.min(project.height - 1, point.y)) }));
  const composed = compositeHeights(project);
  const delta = createFloat32TileBuffer(project.width, project.height);
  const bestWeight = createFloat32TileBuffer(project.width, project.height);
  const innerRadius = Math.max(1, options.widthStuds / (ROBLOX_TERRAIN.studsPerSample * 2));
  const shoulderRadius = Math.max(0, options.shoulderWidthStuds / ROBLOX_TERRAIN.studsPerSample);
  const outerRadius = innerRadius + shoulderRadius;
  const elevationRange = Math.max(1, project.maxElevation - project.minElevation);
  const depth = Math.max(0, options.depthStuds) / elevationRange;
  const normalizedSelection = options.selection ? normalizeSelectionRegion(options.selection) : null;
  const validateMaterialIndex = (value: number | undefined): number | null => {
    if (value === undefined) return null;
    if (!Number.isInteger(value) || value < 0 || value >= ROBLOX_MATERIALS.length) throw new Error('River material selections are invalid.');
    return value;
  };
  const bedMaterialIndex = options.kind === 'river' ? validateMaterialIndex(options.bedMaterialIndex) : null;
  const bankMaterialIndex = options.kind === 'river' ? validateMaterialIndex(options.bankMaterialIndex) : null;

  for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex += 1) {
    checkCancelled(signal);
    const start = path[segmentIndex];
    const end = path[segmentIndex + 1];
    const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - outerRadius));
    const maxX = Math.min(project.width - 1, Math.ceil(Math.max(start.x, end.x) + outerRadius));
    const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - outerRadius));
    const maxY = Math.min(project.height - 1, Math.ceil(Math.max(start.y, end.y) + outerRadius));
    const segmentLengthStuds = Math.hypot(end.x - start.x, end.y - start.y) * ROBLOX_TERRAIN.studsPerSample;
    const startElevation = worldHeightFromNormalized(project, composedValueAt(project, composed, start.x, start.y));
    let endElevation = worldHeightFromNormalized(project, composedValueAt(project, composed, end.x, end.y));
    if (options.kind === 'road') {
      const maximumRise = Math.tan(Math.max(1, options.maxGradeDegrees) * Math.PI / 180) * segmentLengthStuds;
      endElevation = startElevation + clamp((endElevation - startElevation) / Math.max(1, maximumRise), -1, 1) * maximumRise;
    }
    for (let y = minY; y <= maxY; y += 1) {
      checkCancelled(signal);
      for (let x = minX; x <= maxX; x += 1) {
        if (normalizedSelection && !selectionContains(normalizedSelection, x, y)) continue;
        const index = y * project.width + x;
        if ((project.mask[index] ?? 1) <= 0) continue;
        const nearest = nearestPointOnSegment(x, y, start, end);
        if (nearest.distance > outerRadius) continue;
        const falloff = nearest.distance <= innerRadius ? 1 : smoothstep(clamp((outerRadius - nearest.distance) / Math.max(1, shoulderRadius)));
        if (falloff <= bestWeight[index]) continue;
        bestWeight[index] = falloff;
        if (options.kind === 'road') {
          const corridorElevation = startElevation + (endElevation - startElevation) * nearest.t;
          delta[index] = (normalizedFromWorldHeight(project, corridorElevation) - composed[index]) * falloff;
        } else {
          delta[index] = -depth * (0.35 + falloff * 0.65);
        }
      }
      if (y % 24 === 0 || y === maxY) {
        const segmentProgress = (segmentIndex + (y - minY + 1) / Math.max(1, maxY - minY + 1)) / (path.length - 1);
        onProgress?.(segmentProgress);
        await yieldTerrainWork();
      }
    }
  }
  let hasChange = false;
  for (const value of delta) {
    if (Math.abs(value) >= 0.000001) { hasChange = true; break; }
  }
  if (!hasChange) return [];
  const id = `${options.kind}-corridor-${Date.now()}`;
  const layer: HeightLayer = { id, name: options.kind === 'road' ? 'Road corridor' : 'River channel', visible: true, opacity: 1, values: delta };
  project.layers.unshift(layer);
  const changes: EditChange[] = [{ kind: 'height-layer', layerId: id, index: 0, before: null, after: { ...layer, values: cloneFloatBuffer(delta) } }];
  if (options.kind === 'river') {
    const bedCoverage = bedMaterialIndex === null ? null : createFloat32TileBuffer(project.width, project.height);
    const bankCoverage = bankMaterialIndex === null ? null : createFloat32TileBuffer(project.width, project.height);
    if (bedCoverage || bankCoverage) {
      for (let index = 0; index < bestWeight.length; index += 1) {
        const weight = bestWeight[index];
        if (weight <= 0) continue;
        if (bankCoverage) bankCoverage[index] = weight;
        if (bedCoverage && weight >= 0.999) bedCoverage[index] = 1;
      }
      const createdMaterialLayers: Array<{ layer: MaterialLayer; index: number }> = [];
      if (bedCoverage && bedMaterialIndex !== null) createdMaterialLayers.push({ layer: { id: `${id}-bed`, name: 'River bed', visible: true, opacity: 1, materialIndex: bedMaterialIndex, coverage: bedCoverage }, index: 0 });
      if (bankCoverage && bankMaterialIndex !== null && bankMaterialIndex !== bedMaterialIndex) createdMaterialLayers.push({ layer: { id: `${id}-banks`, name: 'River banks', visible: true, opacity: 1, materialIndex: bankMaterialIndex, coverage: bankCoverage }, index: createdMaterialLayers.length });
      for (const created of createdMaterialLayers) {
        project.materialLayers.splice(created.index, 0, created.layer);
        changes.push({ kind: 'material-layer-structure', layerId: created.layer.id, index: created.index, before: null, after: { ...created.layer, coverage: cloneFloatBuffer(created.layer.coverage) } });
      }
    }
  }
  const corridor: CorridorRecord = {
    id,
    kind: options.kind,
    points: path.map((point) => ({ ...point })),
    widthStuds: options.widthStuds,
    shoulderWidthStuds: options.shoulderWidthStuds,
    depthStuds: options.depthStuds,
    maxGradeDegrees: options.maxGradeDegrees,
    ...(bedMaterialIndex === null ? {} : { bedMaterialIndex }),
    ...(bankMaterialIndex === null ? {} : { bankMaterialIndex }),
  };
  project.corridors.unshift(corridor);
  changes.push({ kind: 'corridor-structure', corridorId: corridor.id, index: 0, before: null, after: { ...corridor, points: corridor.points.map((point) => ({ ...point })) } });
  project.updatedAt = new Date().toISOString();
  onProgress?.(1);
  return changes;
}

export function defaultMaterialRules(project: TerrainProject): MaterialRule[] {
  const lookup = (id: string) => ROBLOX_MATERIALS.findIndex((material) => material.id === id);
  return [
    { id: 'rule-snow', name: 'High alpine snow', enabled: true, materialIndex: lookup('snow'), minElevation: Math.min(project.maxElevation - 1, 720), maxElevation: null, minSlope: null, maxSlope: 52, noiseAmount: 0, noiseScaleStuds: 160, priority: 1 },
    { id: 'rule-rock', name: 'Steep rock faces', enabled: true, materialIndex: lookup('rock'), minElevation: null, maxElevation: null, minSlope: 34, maxSlope: null, noiseAmount: 0.12, noiseScaleStuds: 96, priority: 2 },
    { id: 'rule-sand', name: 'Sea-level shore', enabled: true, materialIndex: lookup('sand'), minElevation: project.seaLevel - 8, maxElevation: project.seaLevel + 12, minSlope: null, maxSlope: 18, noiseAmount: 0, noiseScaleStuds: 128, priority: 3 },
    { id: 'rule-grass', name: 'Lowland grass', enabled: true, materialIndex: lookup('grass'), minElevation: null, maxElevation: 620, minSlope: null, maxSlope: 34, noiseAmount: 0, noiseScaleStuds: 128, priority: 4 },
  ];
}

export type ProceduralOptions = { preset: ProceduralPreset; seed: number; scaleStuds: number; amplitudeStuds: number; edgeFalloff: number; selection?: SelectionRegion | null };

function proceduralDeltaAt(project: TerrainProject, options: ProceduralOptions, x: number, y: number): number {
  const range = Math.max(1, project.maxElevation - project.minElevation);
  const scaleSamples = Math.max(2, options.scaleStuds / ROBLOX_TERRAIN.studsPerSample);
  const amplitude = Math.max(0, options.amplitudeStuds) / range;
  const nx = x / Math.max(1, project.width - 1);
  const ny = y / Math.max(1, project.height - 1);
  const broad = fbm(x / scaleSamples, y / scaleSamples, options.seed, 5);
  const detail = fbm(x / Math.max(2, scaleSamples * 0.42), y / Math.max(2, scaleSamples * 0.42), options.seed + 37, 3);
  let target = 0.2 + broad * 0.22;
  if (options.preset === 'rolling-hills') target = 0.25 + broad * 0.34 + detail * 0.08;
  if (options.preset === 'mountains') {
    const ridged = 1 - Math.abs(broad * 2 - 1);
    target = 0.16 + ridged * 0.42 + detail * 0.18;
  }
  if (options.preset === 'plains') target = 0.22 + broad * 0.1 + detail * 0.025;
  if (options.preset === 'island') {
    const distance = Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2) / 0.7072;
    const coast = clamp(1 - Math.pow(distance, Math.max(0.35, options.edgeFalloff)));
    target = 0.04 + coast * (0.36 + broad * 0.35) + detail * 0.06;
  }
  const current = compositeHeightAt(project, x, y);
  const desired = clamp(target + (target - 0.25) * amplitude);
  return Math.max(-1, Math.min(1, desired - current));
}

export function generateProceduralDelta(project: TerrainProject, options: ProceduralOptions): Float32Array {
  const values = new Float32Array(project.width * project.height);
  const selection = options.selection ? normalizeSelectionRegion(options.selection) : null;
  for (let y = 0; y < project.height; y += 1) for (let x = 0; x < project.width; x += 1) {
    const index = y * project.width + x;
    values[index] = selection && !selectionContains(selection, x, y) || (project.mask[index] ?? 1) <= 0 ? 0 : proceduralDeltaAt(project, options, x, y);
  }
  return values;
}

export async function generateProceduralDeltaAsync(project: TerrainProject, options: ProceduralOptions, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Float32Array> {
  const values = new Float32Array(project.width * project.height);
  const selection = options.selection ? normalizeSelectionRegion(options.selection) : null;
  for (let y = 0; y < project.height; y += 1) {
    if (signal?.aborted) throw new DOMException('Terrain generation cancelled.', 'AbortError');
    for (let x = 0; x < project.width; x += 1) {
      const index = y * project.width + x;
      values[index] = selection && !selectionContains(selection, x, y) || (project.mask[index] ?? 1) <= 0 ? 0 : proceduralDeltaAt(project, options, x, y);
    }
    if (y % 24 === 0 || y === project.height - 1) {
      onProgress?.((y + 1) / project.height);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  return values;
}

export function contourSignal(project: TerrainProject, count = 40): number[] {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = Math.round((index / Math.max(1, count - 1)) * (project.width - 1));
    values.push(compositeHeightAt(project, x, Math.round(project.height * 0.42)));
  }
  return values;
}

export const brushToolLabels: Record<ToolId, string> = {
  brush: 'Brush',
  select: 'Select',
  raise: 'Raise',
  lower: 'Lower',
  smooth: 'Smooth',
  flatten: 'Flatten',
  noise: 'Noise',
  slope: 'Slope',
  paint: 'Material paint',
  terrace: 'Terrace',
  ridge: 'Ridge',
  valley: 'Valley',
  plateau: 'Plateau',
  road: 'Road corridor',
  river: 'River channel',
  mask: 'Protect mask',
};

export const DEFAULT_PROJECT_OPTIONS = {
  name: 'Untitled terrain',
  worldWidth: 2048,
  worldDepth: 2048,
  minElevation: 0,
  maxElevation: 1024,
  seaLevel: 128,
  seed: 4817,
  startingTerrain: 'gentle-noise' as StartingTerrain,
};
