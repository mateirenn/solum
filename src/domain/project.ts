import { ROBLOX_MATERIALS, ROBLOX_TERRAIN } from './roblox';
import { clamp, ColormapMapping, compositeHeights, CorridorRecord, materialAt, MaterialLayer, TerrainProject, worldHeightFromNormalized } from './terrain';
import { ByteTileBuffer, createFloat32TileBuffer, createUint8TileBuffer, FloatTileBuffer, float32TileBufferFrom, isTileBackedBuffer, TERRAIN_TILE_SIZE, uint8TileBufferFrom } from './tileBuffer';

type SerializedLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  values: number[];
};

type SerializedProjectV1 = {
  schemaVersion: 1;
  name: string;
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  seaLevel: number;
  seed: number;
  base: number[];
  layers: SerializedLayer[];
  materials: number[];
  updatedAt?: string;
};

type SerializedTileLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  tiles: string[];
};

type SerializedTileMaterialLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  materialIndex: number;
  coverageTiles: string[];
};

type SerializedProjectV2 = {
  schemaVersion: 2;
  storage: 'tiles-v1';
  tileSize: 256;
  name: string;
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  seaLevel: number;
  seed: number;
  baseTiles: string[];
  layers: SerializedTileLayer[];
  materialTiles: string[];
  materialLayers: SerializedTileMaterialLayer[];
  maskTiles: string[];
  corridors: CorridorRecord[];
  colormapMappings: ColormapMapping[];
  updatedAt?: string;
};

export type SerializedProject = SerializedProjectV1 | SerializedProjectV2;

type SerializedProjectInput = {
  schemaVersion?: unknown;
  storage?: unknown;
  tileSize?: unknown;
  name?: unknown;
  width?: unknown;
  height?: unknown;
  minElevation?: unknown;
  maxElevation?: unknown;
  seaLevel?: unknown;
  seed?: unknown;
  base?: unknown;
  layers?: unknown;
  materials?: unknown;
  baseTiles?: unknown;
  materialTiles?: unknown;
  materialLayers?: unknown;
  maskTiles?: unknown;
  corridors?: unknown;
  colormapMappings?: unknown;
  updatedAt?: unknown;
};

export type RecentProject = {
  name: string;
  openedAt: string;
  samples: string;
};

export type ColormapColorMapping = {
  key: string;
  rgb: [number, number, number];
  count: number;
  materialIndex: number;
};

const RECENTS_KEY = 'solum.recent-projects.v1';
const RECOVERY_KEY = 'solum.recovery-project.v1';
const TILE_SIZE = TERRAIN_TILE_SIZE;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value) throw new Error('Project tile data is invalid.');
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error('Project tile data is not valid base64.');
  }
}

type SerializableBuffer = FloatTileBuffer | ByteTileBuffer;

function bufferBytesPerSample(values: SerializableBuffer): number {
  return values instanceof Float32Array || (isTileBackedBuffer(values) && values.kind === 'float32') ? Float32Array.BYTES_PER_ELEMENT : Uint8Array.BYTES_PER_ELEMENT;
}

function bytesForTile(values: SerializableBuffer, width: number, height: number, tileX: number, tileY: number): Uint8Array {
  const tileWidth = Math.min(TILE_SIZE, width - tileX * TILE_SIZE);
  const tileHeight = Math.min(TILE_SIZE, height - tileY * TILE_SIZE);
  const bytesPerSample = bufferBytesPerSample(values);
  if (isTileBackedBuffer(values)) {
    const tile = values.readTile(tileX, tileY);
    return new Uint8Array(tile.buffer, tile.byteOffset, tile.byteLength);
  }
  const source = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const tileBytes = new Uint8Array(tileWidth * tileHeight * bytesPerSample);
  for (let row = 0; row < tileHeight; row += 1) {
    const sourceStart = ((tileY * TILE_SIZE + row) * width + tileX * TILE_SIZE) * bytesPerSample;
    const targetStart = row * tileWidth * bytesPerSample;
    tileBytes.set(source.subarray(sourceStart, sourceStart + tileWidth * bytesPerSample), targetStart);
  }
  return tileBytes;
}

function encodeTiledData(values: SerializableBuffer, width: number, height: number): string[] {
  const tiles: string[] = [];
  const columns = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      tiles.push(bytesToBase64(bytesForTile(values, width, height, tileX, tileY)));
    }
  }
  return tiles;
}

function checkExportCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Project serialization cancelled.', 'AbortError');
}

async function encodeTiledDataAsync(values: SerializableBuffer, width: number, height: number, signal?: AbortSignal, onProgress?: (progress: number) => void): Promise<string[]> {
  const tiles: string[] = [];
  const columns = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const total = Math.max(1, columns * rows);
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      checkExportCancelled(signal);
      tiles.push(bytesToBase64(bytesForTile(values, width, height, tileX, tileY)));
      onProgress?.(tiles.length / total);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  return tiles;
}

function decodeTiledData(tiles: unknown[], width: number, height: number, kind: 'float32'): FloatTileBuffer;
function decodeTiledData(tiles: unknown[], width: number, height: number, kind: 'uint8'): ByteTileBuffer;
function decodeTiledData(tiles: unknown[], width: number, height: number, kind: 'float32' | 'uint8'): FloatTileBuffer | ByteTileBuffer {
  const bytesPerSample = kind === 'float32' ? Float32Array.BYTES_PER_ELEMENT : Uint8Array.BYTES_PER_ELEMENT;
  const output = kind === 'float32' ? createFloat32TileBuffer(width, height) : createUint8TileBuffer(width, height);
  const columns = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  if (tiles.length !== columns * rows) throw new Error('Project tile count does not match its dimensions.');
  let tileIndex = 0;
  for (let tileY = 0; tileY < rows; tileY += 1) {
    const startY = tileY * TILE_SIZE;
    const tileHeight = Math.min(TILE_SIZE, height - startY);
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const startX = tileX * TILE_SIZE;
      const tileWidth = Math.min(TILE_SIZE, width - startX);
      const tileBytes = base64ToBytes(tiles[tileIndex]);
      const expectedBytes = tileWidth * tileHeight * bytesPerSample;
      if (tileBytes.length !== expectedBytes) throw new Error('Project tile dimensions are invalid.');
      const decoded = kind === 'float32'
        ? new Float32Array(tileBytes.buffer, tileBytes.byteOffset, tileBytes.byteLength / Float32Array.BYTES_PER_ELEMENT)
        : tileBytes;
      if (kind === 'float32' && Array.from(decoded).some((value) => !Number.isFinite(value))) throw new Error('Project height tile contains a non-finite value.');
      output.writeTile(tileX, tileY, decoded, false);
      tileIndex += 1;
    }
  }
  output.clearDirtyTiles();
  return output;
}

export function serializeProject(project: TerrainProject): SerializedProjectV2 {
  return {
    schemaVersion: 2,
    storage: 'tiles-v1',
    tileSize: TILE_SIZE,
    name: project.name,
    width: project.width,
    height: project.height,
    minElevation: project.minElevation,
    maxElevation: project.maxElevation,
    seaLevel: project.seaLevel,
    seed: project.seed,
    baseTiles: encodeTiledData(project.base, project.width, project.height),
    layers: project.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, tiles: encodeTiledData(layer.values, project.width, project.height) })),
    materialTiles: encodeTiledData(project.materials, project.width, project.height),
    materialLayers: project.materialLayers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, materialIndex: layer.materialIndex, coverageTiles: encodeTiledData(layer.coverage, project.width, project.height) })),
    maskTiles: encodeTiledData(project.mask, project.width, project.height),
    corridors: project.corridors.map((corridor) => ({ ...corridor, points: corridor.points.map((point) => ({ ...point })) })),
    colormapMappings: project.colormapMappings.map((mapping) => ({ ...mapping, rgb: [...mapping.rgb] as [number, number, number] })),
    updatedAt: project.updatedAt,
  };
}

export async function serializeProjectAsync(project: TerrainProject, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<SerializedProjectV2> {
  const baseTiles = await encodeTiledDataAsync(project.base, project.width, project.height, signal, (progress) => onProgress?.(progress * 0.18));
  const layers: SerializedTileLayer[] = [];
  for (let index = 0; index < project.layers.length; index += 1) {
    const layer = project.layers[index];
    const tiles = await encodeTiledDataAsync(layer.values, project.width, project.height, signal, (progress) => onProgress?.(0.18 + ((index + progress) / Math.max(1, project.layers.length)) * 0.32));
    layers.push({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, tiles });
  }
  const materialTiles = await encodeTiledDataAsync(project.materials, project.width, project.height, signal, (progress) => onProgress?.(0.5 + progress * 0.14));
  const materialLayers: SerializedTileMaterialLayer[] = [];
  for (let index = 0; index < project.materialLayers.length; index += 1) {
    const layer = project.materialLayers[index];
    const coverageTiles = await encodeTiledDataAsync(layer.coverage, project.width, project.height, signal, (progress) => onProgress?.(0.64 + ((index + progress) / Math.max(1, project.materialLayers.length)) * 0.2));
    materialLayers.push({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, materialIndex: layer.materialIndex, coverageTiles });
  }
  const maskTiles = await encodeTiledDataAsync(project.mask, project.width, project.height, signal, (progress) => onProgress?.(0.84 + progress * 0.16));
  onProgress?.(1);
  return { schemaVersion: 2, storage: 'tiles-v1', tileSize: TILE_SIZE, name: project.name, width: project.width, height: project.height, minElevation: project.minElevation, maxElevation: project.maxElevation, seaLevel: project.seaLevel, seed: project.seed, baseTiles, layers, materialTiles, materialLayers, maskTiles, corridors: project.corridors.map((corridor) => ({ ...corridor, points: corridor.points.map((point) => ({ ...point })) })), colormapMappings: project.colormapMappings.map((mapping) => ({ ...mapping, rgb: [...mapping.rgb] as [number, number, number] })), updatedAt: project.updatedAt };
}

function assertArrayLength(name: string, values: unknown[], expected: number): void {
  if (values.length !== expected || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`Invalid ${name} data for this terrain project.`);
  }
}

function decodeCorridors(input: unknown, width: number, height: number): CorridorRecord[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('Project corridor metadata is invalid.');
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Project corridor metadata is invalid.');
    const value = raw as Partial<CorridorRecord>;
    if (typeof value.id !== 'string' || !value.id || (value.kind !== 'road' && value.kind !== 'river') || !Array.isArray(value.points) || value.points.length < 2) throw new Error('Project corridor metadata is invalid.');
    const points = value.points.map((point) => {
      if (!point || typeof point !== 'object' || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Project corridor points are invalid.');
      if (point.x < 0 || point.x > width - 1 || point.y < 0 || point.y > height - 1) throw new Error('Project corridor points are outside the terrain.');
      return { x: point.x, y: point.y };
    });
    const numberField = (field: keyof Pick<CorridorRecord, 'widthStuds' | 'shoulderWidthStuds' | 'depthStuds' | 'maxGradeDegrees'>): number => {
      const valueAtField = value[field];
      if (typeof valueAtField !== 'number' || !Number.isFinite(valueAtField) || valueAtField < 0) throw new Error('Project corridor settings are invalid.');
      return valueAtField;
    };
    const materialField = (field: 'bedMaterialIndex' | 'bankMaterialIndex'): number | undefined => {
      const valueAtField = value[field];
      if (valueAtField === undefined) return undefined;
      if (!Number.isInteger(valueAtField) || valueAtField < 0 || valueAtField >= ROBLOX_MATERIALS.length) throw new Error('Project corridor material settings are invalid.');
      return valueAtField;
    };
    const bedMaterialIndex = materialField('bedMaterialIndex');
    const bankMaterialIndex = materialField('bankMaterialIndex');
    return { id: value.id, kind: value.kind, points, widthStuds: numberField('widthStuds'), shoulderWidthStuds: numberField('shoulderWidthStuds'), depthStuds: numberField('depthStuds'), maxGradeDegrees: numberField('maxGradeDegrees'), ...(bedMaterialIndex === undefined ? {} : { bedMaterialIndex }), ...(bankMaterialIndex === undefined ? {} : { bankMaterialIndex }) };
  });
}

function decodeColormapMappings(input: unknown): ColormapMapping[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('Project colormap mappings are invalid.');
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Project colormap mappings are invalid.');
    const value = raw as Partial<ColormapMapping>;
    const rgb = value.rgb;
    const materialIndex = value.materialIndex;
    const count = value.count;
    if (typeof value.key !== 'string' || !value.key || !Array.isArray(rgb) || rgb.length !== 3 || rgb.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255) || typeof materialIndex !== 'number' || !Number.isInteger(materialIndex) || materialIndex < 0 || materialIndex >= ROBLOX_MATERIALS.length || typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw new Error('Project colormap mappings are invalid.');
    return { key: value.key, rgb: [rgb[0], rgb[1], rgb[2]] as [number, number, number], count, materialIndex };
  });
}

export function deserializeProject(input: unknown): TerrainProject {
  if (!input || typeof input !== 'object') throw new Error('The selected file is not a Solum project.');
  const data = input as SerializedProjectInput;
  if (data.schemaVersion !== 1 && data.schemaVersion !== 2) throw new Error(`Unsupported .rterrain schema version: ${String(data.schemaVersion)}.`);
  const width = data.width;
  const height = data.height;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Project dimensions are invalid.');
  if (width > ROBLOX_TERRAIN.maxHeightmapWidth || height > ROBLOX_TERRAIN.maxHeightmapHeight) throw new Error('Project exceeds Roblox heightmap limits.');
  const expected = width * height;
  let base: FloatTileBuffer;
  let materials: ByteTileBuffer;
  let layers: TerrainProject['layers'];
  let materialLayers: MaterialLayer[];
  let mask: FloatTileBuffer;
  let corridors: CorridorRecord[];
  let colormapMappings: ColormapMapping[];
  if (data.schemaVersion === 1) {
    if (!Array.isArray(data.base) || !Array.isArray(data.materials) || !Array.isArray(data.layers)) throw new Error('Project arrays are missing.');
    assertArrayLength('base height', data.base, expected);
    assertArrayLength('material', data.materials, expected);
    base = float32TileBufferFrom(data.base.map((value) => clamp(value)), width, height);
    materials = uint8TileBufferFrom(data.materials.map((value) => Math.max(0, Math.min(ROBLOX_MATERIALS.length - 1, Math.round(value)))), width, height);
    layers = (data.layers as unknown[]).map((rawLayer) => {
      const layer = rawLayer as Partial<SerializedLayer>;
      if (!layer || typeof layer.id !== 'string' || typeof layer.name !== 'string' || !Array.isArray(layer.values)) throw new Error('Project layer data is invalid.');
      assertArrayLength(`layer ${layer.name}`, layer.values, expected);
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible !== false,
        opacity: clamp(typeof layer.opacity === 'number' ? layer.opacity : 1),
        values: float32TileBufferFrom(layer.values.map((value) => Math.max(-1, Math.min(1, value))), width, height),
      };
    });
    materialLayers = [];
    mask = createFloat32TileBuffer(width, height, 1);
    corridors = [];
    colormapMappings = [];
  } else {
    if (data.storage !== 'tiles-v1' || data.tileSize !== TILE_SIZE || !Array.isArray(data.baseTiles) || !Array.isArray(data.materialTiles) || !Array.isArray(data.layers)) throw new Error('Project tile storage is missing or unsupported.');
    base = decodeTiledData(data.baseTiles, width, height, 'float32');
    for (let index = 0; index < base.length; index += 1) base[index] = clamp(base[index]);
    materials = decodeTiledData(data.materialTiles, width, height, 'uint8');
    for (let index = 0; index < materials.length; index += 1) materials[index] = Math.min(ROBLOX_MATERIALS.length - 1, materials[index]);
    layers = (data.layers as unknown[]).map((rawLayer) => {
      const layer = rawLayer as Partial<SerializedTileLayer>;
      if (!layer || typeof layer.id !== 'string' || typeof layer.name !== 'string' || !Array.isArray(layer.tiles)) throw new Error('Project layer data is invalid.');
      const values = decodeTiledData(layer.tiles, width, height, 'float32');
      for (let index = 0; index < values.length; index += 1) values[index] = Math.max(-1, Math.min(1, values[index]));
      return { id: layer.id, name: layer.name, visible: layer.visible !== false, opacity: clamp(typeof layer.opacity === 'number' ? layer.opacity : 1), values };
    });
    materialLayers = Array.isArray(data.materialLayers) ? (data.materialLayers as unknown[]).map((rawLayer) => {
      const layer = rawLayer as Partial<SerializedTileMaterialLayer>;
      if (!layer || typeof layer.id !== 'string' || typeof layer.name !== 'string' || !Array.isArray(layer.coverageTiles)) throw new Error('Project material layer data is invalid.');
      const coverage = decodeTiledData(layer.coverageTiles, width, height, 'float32');
      for (let index = 0; index < coverage.length; index += 1) coverage[index] = clamp(coverage[index]);
      return { id: layer.id, name: layer.name, visible: layer.visible !== false, opacity: clamp(typeof layer.opacity === 'number' ? layer.opacity : 1), materialIndex: Math.max(0, Math.min(ROBLOX_MATERIALS.length - 1, Math.round(typeof layer.materialIndex === 'number' ? layer.materialIndex : 0))), coverage };
    }) : [];
    mask = Array.isArray(data.maskTiles) ? decodeTiledData(data.maskTiles, width, height, 'float32') : createFloat32TileBuffer(width, height, 1);
    for (let index = 0; index < mask.length; index += 1) mask[index] = clamp(mask[index]);
    corridors = decodeCorridors(data.corridors, width, height);
    colormapMappings = decodeColormapMappings(data.colormapMappings);
  }
  if (typeof data.minElevation !== 'number' || typeof data.maxElevation !== 'number' || data.maxElevation <= data.minElevation) throw new Error('Project elevation range is invalid.');
  return {
    schemaVersion: 1,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Untitled terrain',
    width,
    height,
    minElevation: data.minElevation,
    maxElevation: data.maxElevation,
    seaLevel: typeof data.seaLevel === 'number' ? data.seaLevel : data.minElevation,
    seed: typeof data.seed === 'number' ? data.seed : 1,
    base,
    layers,
    materials,
    materialLayers,
    mask,
    corridors,
    colormapMappings,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export function projectFileName(project: Pick<TerrainProject, 'name'>): string {
  const safeName = project.name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').slice(0, 72) || 'untitled-terrain';
  return `${safeName}${ROBLOX_TERRAIN.projectExtension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveProjectDownload(project: TerrainProject): void {
  const json = JSON.stringify(serializeProject(project));
  downloadBlob(new Blob([json], { type: 'application/json' }), projectFileName(project));
  rememberProject(project);
}

export async function saveProjectDownloadAsync(project: TerrainProject, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<void> {
  const serialized = await serializeProjectAsync(project, onProgress, signal);
  checkExportCancelled(signal);
  const json = JSON.stringify(serialized);
  downloadBlob(new Blob([json], { type: 'application/json' }), projectFileName(project));
  rememberProject(project);
}

export async function readProjectFile(file: File): Promise<TerrainProject> {
  const text = await file.text();
  try {
    return deserializeProject(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('This file is not valid JSON.');
    throw error;
  }
}

async function readRaster(file: File): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This image could not be decoded.');
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importHeightmapFile(file: File, project: TerrainProject): Promise<TerrainProject> {
  const raster = await readRaster(file);
  if (raster.width <= 0 || raster.height <= 0 || raster.width > ROBLOX_TERRAIN.maxHeightmapWidth || raster.height > ROBLOX_TERRAIN.maxHeightmapHeight) throw new Error(`Heightmap must be at most ${ROBLOX_TERRAIN.maxHeightmapWidth} × ${ROBLOX_TERRAIN.maxHeightmapHeight} pixels.`);
  const base = createFloat32TileBuffer(raster.width, raster.height);
  for (let index = 0; index < base.length; index += 1) {
    const source = index * 4;
    base[index] = (raster.data[source] * 0.2126 + raster.data[source + 1] * 0.7152 + raster.data[source + 2] * 0.0722) / 255;
  }
  return { ...project, width: raster.width, height: raster.height, base, layers: [], materials: createUint8TileBuffer(raster.width, raster.height), materialLayers: [], mask: createFloat32TileBuffer(raster.width, raster.height, 1), corridors: [], colormapMappings: [], updatedAt: new Date().toISOString(), name: project.name === 'Untitled terrain' ? file.name.replace(/\.[^.]+$/, '') || project.name : project.name };
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  return red * red + green * green + blue * blue;
}

function colorKey(color: [number, number, number]): string {
  return `${color[0]},${color[1]},${color[2]}`;
}

function nearestMaterialIndex(color: [number, number, number]): number {
  let closest = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  ROBLOX_MATERIALS.forEach((material, materialIndex) => {
    const distance = colorDistance(color, material.exportKeyColor);
    if (distance < closestDistance) { closest = materialIndex; closestDistance = distance; }
  });
  return closest;
}

export async function inspectColormapFile(file: File, project: TerrainProject): Promise<{ mappings: ColormapColorMapping[]; truncated: boolean }> {
  const raster = await readRaster(file);
  if (raster.width !== project.width || raster.height !== project.height) throw new Error(`Colormap must match the project at ${project.width} × ${project.height} pixels.`);
  const limit = 64;
  const entries = new Map<string, ColormapColorMapping>();
  let truncated = false;
  for (let index = 0; index < project.materials.length; index += 1) {
    const source = index * 4;
    const rgb: [number, number, number] = [raster.data[source], raster.data[source + 1], raster.data[source + 2]];
    const key = colorKey(rgb);
    const existing = entries.get(key);
    if (existing) existing.count += 1;
    else if (entries.size < limit) entries.set(key, { key, rgb, count: 1, materialIndex: nearestMaterialIndex(rgb) });
    else truncated = true;
  }
  return { mappings: Array.from(entries.values()).sort((a, b) => b.count - a.count), truncated };
}

export async function importColormapFile(file: File, project: TerrainProject, mapping?: Record<string, number>): Promise<import('./terrain').EditChange[]> {
  const raster = await readRaster(file);
  if (raster.width !== project.width || raster.height !== project.height) throw new Error(`Colormap must match the project at ${project.width} × ${project.height} pixels.`);
  const changes: import('./terrain').EditChange[] = [];
  for (let index = 0; index < project.materials.length; index += 1) {
    const source = index * 4;
    const color: [number, number, number] = [raster.data[source], raster.data[source + 1], raster.data[source + 2]];
    const mapped = mapping?.[colorKey(color)];
    const closest = typeof mapped === 'number' && Number.isInteger(mapped) && mapped >= 0 && mapped < ROBLOX_MATERIALS.length ? mapped : nearestMaterialIndex(color);
    const before = project.materials[index];
    if (before !== closest) {
      project.materials[index] = closest;
      changes.push({ kind: 'material', index, before, after: closest });
    }
  }
  if (changes.length) project.updatedAt = new Date().toISOString();
  return changes;
}

export function pngBlobForProject(project: TerrainProject, type: 'heightmap' | 'colormap'): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  const image = context.createImageData(project.width, project.height);
  image.data.set(exportPixelData(project, type));
  context.putImageData(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function exportPixelData(project: TerrainProject, type: 'heightmap' | 'colormap'): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(project.width * project.height * 4);
  const composed = type === 'heightmap' ? compositeHeights(project) : null;
  for (let index = 0; index < project.width * project.height; index += 1) {
    const output = index * 4;
    if (type === 'heightmap') {
      const channel = Math.round(clamp(composed?.[index] ?? 0) * 255);
      pixels[output] = channel;
      pixels[output + 1] = channel;
      pixels[output + 2] = channel;
    } else {
      const color = ROBLOX_MATERIALS[materialAt(project, index)]?.exportKeyColor ?? ROBLOX_MATERIALS[0].exportKeyColor;
      pixels[output] = color[0];
      pixels[output + 1] = color[1];
      pixels[output + 2] = color[2];
    }
    pixels[output + 3] = 255;
  }
  return pixels;
}

export async function exportPixelDataAsync(project: TerrainProject, type: 'heightmap' | 'colormap', onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Uint8ClampedArray> {
  const pixels = new Uint8ClampedArray(project.width * project.height * 4);
  const composed = type === 'heightmap' ? compositeHeights(project) : null;
  for (let y = 0; y < project.height; y += 1) {
    if (signal?.aborted) throw new DOMException('Terrain export cancelled.', 'AbortError');
    for (let x = 0; x < project.width; x += 1) {
      const index = y * project.width + x;
      const output = index * 4;
      if (type === 'heightmap') {
        const channel = Math.round(clamp(composed?.[index] ?? 0) * 255);
        pixels[output] = channel;
        pixels[output + 1] = channel;
        pixels[output + 2] = channel;
      } else {
        const color = ROBLOX_MATERIALS[materialAt(project, index)]?.exportKeyColor ?? ROBLOX_MATERIALS[0].exportKeyColor;
        pixels[output] = color[0];
        pixels[output + 1] = color[1];
        pixels[output + 2] = color[2];
      }
      pixels[output + 3] = 255;
    }
    if (y % 24 === 0 || y === project.height - 1) {
      onProgress?.((y + 1) / project.height);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return pixels;
}

export async function pngBlobForProjectAsync(project: TerrainProject, type: 'heightmap' | 'colormap', onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(project.width, project.height);
  image.data.set(await exportPixelDataAsync(project, type, onProgress, signal));
  context.putImageData(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function exportManifestForProject(project: TerrainProject, stem = projectFileName(project).replace(/\.rterrain$/, '')) {
  return {
    format: 'solum-roblox-terrain-export',
    version: 1,
    sourceProject: project.name,
    application: { name: 'Solum', version: '0.1.0' },
    exportedAt: new Date().toISOString(),
    heightmap: `${stem}-heightmap.png`,
    colormap: `${stem}-colormap.png`,
    samples: { width: project.width, height: project.height },
    worldSizeStuds: { width: project.width * ROBLOX_TERRAIN.studsPerSample, depth: project.height * ROBLOX_TERRAIN.studsPerSample },
    studsPerHeightmapPixel: ROBLOX_TERRAIN.studsPerSample,
    elevation: { min: project.minElevation, max: project.maxElevation, seaLevel: project.seaLevel },
    coordinateConvention: 'image X -> Roblox X; image Y -> Roblox Z',
    materialKeys: Object.fromEntries(ROBLOX_MATERIALS.map((material) => [material.enumName, material.exportKeyColor])),
  };
}

export async function exportTerrainAssets(project: TerrainProject): Promise<void> {
  const stem = projectFileName(project).replace(/\.rterrain$/, '');
  const heightmap = await pngBlobForProjectAsync(project, 'heightmap');
  const colormap = await pngBlobForProjectAsync(project, 'colormap');
  if (heightmap) downloadBlob(heightmap, `${stem}-heightmap.png`);
  if (colormap) downloadBlob(colormap, `${stem}-colormap.png`);
  const manifest = exportManifestForProject(project, stem);
  downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${stem}-manifest.json`);
}

export function rememberProject(project: TerrainProject): void {
  try {
    const existing = getRecentProjects().filter((item) => item.name !== project.name);
    const next: RecentProject[] = [{ name: project.name, openedAt: new Date().toISOString(), samples: `${project.width} × ${project.height}` }, ...existing].slice(0, 5);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Local storage is a convenience only; saving the project must still succeed.
  }
}

export function saveRecoverySnapshot(project: TerrainProject): void {
  // Keep autosave bounded until native tiled persistence lands. Large projects remain dirty
  // and explicitly savable without risking a multi-megabyte synchronous localStorage write.
  if (project.base.length > 300_000) return;
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify(serializeProject(project))); } catch { /* recovery is best effort */ }
}

export function getRecoveryProject(): TerrainProject | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    return raw ? deserializeProject(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function clearRecoverySnapshot(): void {
  try { localStorage.removeItem(RECOVERY_KEY); } catch { /* recovery is a convenience */ }
}

export function getRecentProjects(): RecentProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is RecentProject => item && typeof item.name === 'string' && typeof item.samples === 'string') : [];
  } catch {
    return [];
  }
}

export function elevationLabel(project: TerrainProject, normalized: number): string {
  return `${Math.round(worldHeightFromNormalized(project, normalized)).toLocaleString()} studs`;
}
