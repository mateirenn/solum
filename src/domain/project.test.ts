import { describe, expect, it } from 'vitest';
import { deserializeProject, exportManifestForProject, exportPixelData, projectFileName, serializeProject, serializeProjectAsync } from './project';
import { createTerrainProject } from './terrain';
import { createFloat32TileBuffer } from './tileBuffer';

function sampleProject() {
  const project = createTerrainProject({ name: 'Harbor / North', worldWidth: 128, worldDepth: 128, minElevation: -64, maxElevation: 960, seaLevel: 72, seed: 12, startingTerrain: 'gentle-noise' });
  project.layers.push({ id: 'mountains', name: 'Mountains', visible: true, opacity: 0.7, values: new Float32Array(project.base.length).fill(0.12) });
  project.materials[5] = 4;
  const materialCoverage = new Float32Array(project.base.length);
  materialCoverage[5] = 1;
  project.materialLayers.push({ id: 'rock-overlay', name: 'Rock overlay', visible: true, opacity: 0.85, materialIndex: 4, coverage: materialCoverage });
  return project;
}

describe('versioned project persistence', () => {
  it('keeps runtime terrain sparse and tracks dirty tiles', () => {
    const values = createFloat32TileBuffer(520, 520);
    expect(values.allocatedTileCount).toBe(0);
    expect(values[519 * 520 + 519]).toBe(0);
    values[519 * 520 + 519] = 0.75;
    expect(values.allocatedTileCount).toBe(1);
    expect(values.dirtyTileKeys()).toEqual([8]);
    expect(values.tileKeysForRegion(255, 255, 257, 257)).toEqual([0, 1, 3, 4]);
    expect(values.consumeDirtyTileKeys()).toEqual([8]);
    expect(values.dirtyTileCount).toBe(0);
    expect(values[519 * 520 + 519]).toBeCloseTo(0.75);
  });

  it('preserves terrain arrays, layers, and settings through JSON', () => {
    const original = sampleProject();
    const serialized = serializeProject(original);
    expect(serialized.schemaVersion).toBe(2);
    expect(serialized.storage).toBe('tiles-v1');
    expect(serialized.tileSize).toBe(256);
    expect(serialized.baseTiles).toHaveLength(1);
    const reopened = deserializeProject(serialized);
    expect(reopened.name).toBe(original.name);
    expect(reopened.minElevation).toBe(-64);
    expect(reopened.seaLevel).toBe(72);
    expect(Array.from(reopened.base)).toEqual(Array.from(original.base));
    expect(Array.from(reopened.layers[0].values)).toEqual(Array.from(original.layers[0].values));
    expect(reopened.materials[5]).toBe(4);
    expect(reopened.materialLayers[0].name).toBe('Rock overlay');
    expect(reopened.materialLayers[0].coverage[5]).toBe(1);
  });

  it('persists editable corridor metadata with its control points', () => {
    const original = createTerrainProject({ name: 'Corridor metadata', worldWidth: 128, worldDepth: 128, minElevation: 0, maxElevation: 1000, seaLevel: 100, seed: 7, startingTerrain: 'flat' });
    original.corridors.push({ id: 'road-1', kind: 'road', points: [{ x: 2, y: 4 }, { x: 18, y: 20 }, { x: 28, y: 12 }], widthStuds: 24, shoulderWidthStuds: 40, depthStuds: 0, maxGradeDegrees: 12 });
    const reopened = deserializeProject(serializeProject(original));
    expect(reopened.corridors).toEqual(original.corridors);
    expect(reopened.corridors).not.toBe(original.corridors);
    expect(reopened.corridors[0].points).not.toBe(original.corridors[0].points);
  });

  it('persists explicit colormap RGB-to-material mappings', () => {
    const original = createTerrainProject({ name: 'Colormap mapping', worldWidth: 128, worldDepth: 128, minElevation: 0, maxElevation: 1000, seaLevel: 100, seed: 7, startingTerrain: 'flat' });
    original.colormapMappings.push({ key: '119,124,126', rgb: [119, 124, 126], count: 42, materialIndex: 4 });
    const reopened = deserializeProject(serializeProject(original));
    expect(reopened.colormapMappings).toEqual(original.colormapMappings);
    expect(reopened.colormapMappings).not.toBe(original.colormapMappings);
  });

  it('continues to open legacy version 1 array projects', () => {
    const original = sampleProject();
    const tiled = serializeProject(original);
    const legacy = {
      schemaVersion: 1 as const,
      name: original.name,
      width: original.width,
      height: original.height,
      minElevation: original.minElevation,
      maxElevation: original.maxElevation,
      seaLevel: original.seaLevel,
      seed: original.seed,
      base: Array.from(original.base),
      layers: original.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, values: Array.from(layer.values) })),
      materials: Array.from(original.materials),
      updatedAt: tiled.updatedAt,
    };
    const reopened = deserializeProject(legacy);
    expect(Array.from(reopened.base)).toEqual(Array.from(original.base));
    expect(Array.from(reopened.layers[0].values)).toEqual(Array.from(original.layers[0].values));
    expect(Array.from(reopened.materials)).toEqual(Array.from(original.materials));
  });

  it('round-trips partial edge tiles without padding samples', () => {
    const original = createTerrainProject({ name: 'Edge tiles', worldWidth: 1040, worldDepth: 1036, minElevation: 0, maxElevation: 1024, seaLevel: 128, seed: 7, startingTerrain: 'flat' });
    const last = original.base.length - 1;
    original.base[last] = 0.91;
    original.materials[last] = 4;
    const serialized = serializeProject(original);
    expect(serialized.baseTiles).toHaveLength(4);
    expect(serialized.materialTiles).toHaveLength(4);
    const reopened = deserializeProject(serialized);
    expect(reopened.width).toBe(260);
    expect(reopened.height).toBe(259);
    expect(reopened.base[last]).toBeCloseTo(0.91);
    expect(reopened.materials[last]).toBe(4);
  });

  it('rejects unknown schema versions instead of reinterpreting them', () => {
    expect(() => deserializeProject({ ...serializeProject(sampleProject()), schemaVersion: 99 })).toThrow(/Unsupported/);
  });

  it('creates a safe .rterrain file name', () => {
    expect(projectFileName(sampleProject())).toBe('Harbor---North.rterrain');
  });

  it('exports dimensions, grayscale elevation, material keys, and manifest mapping', () => {
    const project = createTerrainProject({ name: 'Export proof', worldWidth: 16, worldDepth: 16, minElevation: 0, maxElevation: 100, seaLevel: 20, seed: 1, startingTerrain: 'flat' });
    project.base[0] = 0;
    project.base[1] = 1;
    project.materials[2] = 4;
    const heightPixels = exportPixelData(project, 'heightmap');
    const colorPixels = exportPixelData(project, 'colormap');
    expect(heightPixels).toHaveLength(project.width * project.height * 4);
    expect(heightPixels[0]).toBe(0);
    expect(heightPixels[4]).toBe(255);
    expect(colorPixels.slice(8, 11)).toEqual(new Uint8ClampedArray([119, 124, 126]));
    const manifest = exportManifestForProject(project, 'export-proof');
    expect(manifest.samples).toEqual({ width: 4, height: 4 });
    expect(manifest.worldSizeStuds).toEqual({ width: 16, depth: 16 });
    expect(manifest.studsPerHeightmapPixel).toBe(4);
    expect(manifest.materialKeys.Rock).toEqual([119, 124, 126]);
  });

  it('serializes tiled project data asynchronously with progress', async () => {
    const original = createTerrainProject({ name: 'Async save', worldWidth: 1040, worldDepth: 1036, minElevation: 0, maxElevation: 1024, seaLevel: 128, seed: 7, startingTerrain: 'flat' });
    const progress: number[] = [];
    const serialized = await serializeProjectAsync(original, (value) => progress.push(value));
    expect(serialized.schemaVersion).toBe(2);
    expect(progress.at(-1)).toBe(1);
    expect(Array.from(deserializeProject(serialized).base)).toEqual(Array.from(original.base));
  });
});
