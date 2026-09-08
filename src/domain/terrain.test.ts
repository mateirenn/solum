import { describe, expect, it } from 'vitest';
import { ROBLOX_TERRAIN } from './roblox';
import {
  applyBiomeAsync,
  applyBrushStroke,
  applyCorridorAsync,
  applyChanges,
  compositeHeightAt,
  createTerrainProject,
  createTerrainProjectAsync,
  evaluateMaterialRulesAsync,
  evaluateMaterialRules,
  fbm,
  generateProceduralDelta,
  generateProceduralDeltaAsync,
  materialAt,
  materialMapForRules,
  normalizedFromWorldHeight,
  slopeDegreesAt,
  selectionContains,
  terrainStatistics,
  worldHeightFromNormalized,
} from './terrain';

function testProject() {
  return createTerrainProject({ name: 'Test', worldWidth: 128, worldDepth: 128, minElevation: 0, maxElevation: 1000, seaLevel: 100, seed: 7, startingTerrain: 'flat' });
}

describe('Roblox scale and height model', () => {
  it('maps stud footprints to 4-stud samples', () => {
    const project = testProject();
    expect(project.width).toBe(32);
    expect(project.height).toBe(32);
    expect(ROBLOX_TERRAIN.studsPerSample).toBe(4);
  });

  it('round trips normalized and world elevation', () => {
    const project = testProject();
    expect(worldHeightFromNormalized(project, normalizedFromWorldHeight(project, 420))).toBeCloseTo(420);
    expect(normalizedFromWorldHeight(project, -10)).toBe(0);
    expect(normalizedFromWorldHeight(project, 1200)).toBe(1);
  });

  it('reports progress for asynchronous starting terrain generation', async () => {
    const progress: number[] = [];
    const project = await createTerrainProjectAsync({ name: 'Async', worldWidth: 128, worldDepth: 128, minElevation: 0, maxElevation: 1000, seaLevel: 100, seed: 7, startingTerrain: 'gentle-noise' }, (value) => progress.push(value));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
    expect(project.base.some((value) => value !== 0)).toBe(true);
  });
});

describe('terrain operations', () => {
  it('raises and lowers only the brush region with falloff', () => {
    const project = testProject();
    const changes = applyBrushStroke(project, { tool: 'raise', centerX: 16, centerY: 16, radiusStuds: 16, strength: 1, hardness: 0, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(changes.length).toBeGreaterThan(0);
    expect(compositeHeightAt(project, 16, 16)).toBeGreaterThan(compositeHeightAt(project, 2, 2));
    applyChanges(project, changes, 'before');
    expect(compositeHeightAt(project, 16, 16)).toBe(0);
  });

  it('composes visible signed delta layers', () => {
    const project = testProject();
    project.layers.push({ id: 'mountains', name: 'Mountains', visible: true, opacity: 0.5, values: new Float32Array(project.base.length).fill(0.4) });
    expect(compositeHeightAt(project, 10, 10)).toBeCloseTo(0.2);
    project.layers[0].visible = false;
    expect(compositeHeightAt(project, 10, 10)).toBe(0);
  });

  it('paints and composites non-destructive material layers with undo', () => {
    const project = testProject();
    project.materialLayers.push({ id: 'rock-overlay', name: 'Rock overlay', visible: true, opacity: 1, materialIndex: 4, coverage: new Float32Array(project.base.length) });
    const changes = applyBrushStroke(project, { tool: 'paint', centerX: 16, centerY: 16, radiusStuds: 16, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', activeMaterialLayerId: 'rock-overlay', materialIndex: 4 });
    expect(changes.some((change) => change.kind === 'material-layer')).toBe(true);
    expect(materialAt(project, 16 * project.width + 16)).toBe(4);
    applyChanges(project, changes, 'before');
    expect(materialAt(project, 16 * project.width + 16)).toBe(0);
    applyChanges(project, changes, 'after');
    project.materialLayers[0].visible = false;
    expect(materialAt(project, 16 * project.width + 16)).toBe(0);
  });

  it('paints a grayscale protection mask and constrains later edits', () => {
    const project = testProject();
    const center = 16 * project.width + 16;
    const maskChanges = applyBrushStroke(project, { tool: 'mask', centerX: 16, centerY: 16, radiusStuds: 4, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', maskMode: 'protect', materialIndex: 0 });
    expect(project.mask[center]).toBe(0);
    expect(maskChanges.some((change) => change.kind === 'mask')).toBe(true);
    const heightChanges = applyBrushStroke(project, { tool: 'raise', centerX: 16, centerY: 16, radiusStuds: 4, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(project.base[center]).toBe(0);
    expect(heightChanges.some((change) => change.kind === 'height' && change.index === center)).toBe(false);
    applyChanges(project, maskChanges, 'before');
    expect(project.mask[center]).toBe(1);
  });

  it('constrains brush edits to a rectangular selection', () => {
    const project = testProject();
    const changes = applyBrushStroke(project, { tool: 'raise', centerX: 16, centerY: 16, radiusStuds: 48, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', selection: { x0: 14, y0: 14, x1: 18, y1: 18 }, materialIndex: 0 });
    expect(project.base[16 * project.width + 16]).toBeGreaterThan(0);
    expect(project.base[5 * project.width + 5]).toBe(0);
    expect(changes.every((change) => change.kind === 'height')).toBe(true);
  });

  it('constrains edits to a freeform polygon selection', () => {
    const polygon = { kind: 'polygon' as const, points: [{ x: 10, y: 10 }, { x: 22, y: 10 }, { x: 16, y: 22 }] };
    expect(selectionContains(polygon, 16, 14)).toBe(true);
    expect(selectionContains(polygon, 4, 14)).toBe(false);
    const project = testProject();
    const changes = applyBrushStroke(project, { tool: 'raise', centerX: 16, centerY: 16, radiusStuds: 48, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', selection: polygon, materialIndex: 0 });
    expect(changes.some((change) => change.kind === 'height' && change.index === 16 * project.width + 16)).toBe(true);
    expect(changes.some((change) => change.kind === 'height' && change.index === 8 * project.width + 8)).toBe(false);
  });

  it('creates an undoable non-destructive road corridor layer', async () => {
    const project = testProject();
    project.base.fill(0.5);
    project.base[16 * project.width + 4] = 0.2;
    project.base[16 * project.width + 28] = 0.8;
    const changes = await applyCorridorAsync(project, [{ x: 4, y: 16 }, { x: 28, y: 16 }], { kind: 'road', widthStuds: 32, shoulderWidthStuds: 32, depthStuds: 0, maxGradeDegrees: 12 });
    expect(changes.some((change) => change.kind === 'height-layer')).toBe(true);
    expect(changes.some((change) => change.kind === 'corridor-structure')).toBe(true);
    expect(project.layers).toHaveLength(1);
    expect(project.corridors).toHaveLength(1);
    expect(project.corridors[0].points).toEqual([{ x: 4, y: 16 }, { x: 28, y: 16 }]);
    expect(project.layers[0].values.some((value) => value !== 0)).toBe(true);
    applyChanges(project, changes, 'before');
    expect(project.layers).toHaveLength(0);
    expect(project.corridors).toHaveLength(0);
    applyChanges(project, changes, 'after');
    expect(project.layers).toHaveLength(1);
    expect(project.corridors).toHaveLength(1);
    expect(project.layers[0].name).toBe('Road corridor');
  });

  it('carves a river channel with blended banks', async () => {
    const project = testProject();
    project.base.fill(0.5);
    const changes = await applyCorridorAsync(project, [{ x: 4, y: 10 }, { x: 28, y: 22 }], { kind: 'river', widthStuds: 32, shoulderWidthStuds: 48, depthStuds: 96, maxGradeDegrees: 12 });
    expect(changes.some((change) => change.kind === 'height-layer')).toBe(true);
    expect(changes.some((change) => change.kind === 'corridor-structure')).toBe(true);
    expect(project.layers[0].name).toBe('River channel');
    expect(project.layers[0].values.some((value) => value < 0)).toBe(true);
  });

  it('adds undoable river bed and bank material layers', async () => {
    const project = testProject();
    project.base.fill(0.5);
    const changes = await applyCorridorAsync(project, [{ x: 4, y: 10 }, { x: 28, y: 22 }], { kind: 'river', widthStuds: 32, shoulderWidthStuds: 48, depthStuds: 96, maxGradeDegrees: 12, bedMaterialIndex: 7, bankMaterialIndex: 0 });
    expect(changes.filter((change) => change.kind === 'material-layer-structure')).toHaveLength(2);
    expect(project.materialLayers.map((layer) => layer.name)).toEqual(['River bed', 'River banks']);
    expect(materialAt(project, 16 * project.width + 16)).toBe(7);
    applyChanges(project, changes, 'before');
    expect(project.layers).toHaveLength(0);
    expect(project.materialLayers).toHaveLength(0);
    applyChanges(project, changes, 'after');
    expect(project.layers).toHaveLength(1);
    expect(project.materialLayers.map((layer) => layer.name)).toEqual(['River bed', 'River banks']);
    expect(materialAt(project, 16 * project.width + 16)).toBe(7);
  });

  it('rejects invalid river material selections before mutating the project', async () => {
    const project = testProject();
    await expect(applyCorridorAsync(project, [{ x: 4, y: 10 }, { x: 28, y: 22 }], { kind: 'river', widthStuds: 32, shoulderWidthStuds: 48, depthStuds: 96, maxGradeDegrees: 12, bedMaterialIndex: 999 })).rejects.toThrow(/material selections/);
    expect(project.layers).toHaveLength(0);
    expect(project.materialLayers).toHaveLength(0);
  });

  it('smooths toward a local neighborhood and respects flatten target', () => {
    const project = testProject();
    project.base[16 * project.width + 16] = 1;
    applyBrushStroke(project, { tool: 'smooth', centerX: 16, centerY: 16, radiusStuds: 16, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(project.base[16 * project.width + 16]).toBeLessThan(1);
    applyBrushStroke(project, { tool: 'flatten', centerX: 16, centerY: 16, radiusStuds: 4, strength: 1, hardness: 1, targetElevation: 500, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(project.base[16 * project.width + 16]).toBeCloseTo(0.5, 1);
  });

  it('uses deterministic coherent noise', () => {
    expect(fbm(1.2, 4.3, 99)).toBe(fbm(1.2, 4.3, 99));
    expect(fbm(1.2, 4.3, 99)).not.toBe(fbm(1.2, 4.3, 100));
  });

  it('calculates real-world slope in degrees', () => {
    const project = testProject();
    for (let y = 0; y < project.height; y += 1) for (let x = 0; x < project.width; x += 1) project.base[y * project.width + x] = x / (project.width - 1);
    expect(slopeDegreesAt(project, 16, 16)).toBeGreaterThan(0);
    const flat = testProject();
    expect(slopeDegreesAt(flat, 16, 16)).toBeCloseTo(0);
  });

  it('reduces an over-grade step using real 4-stud spacing', () => {
    const project = testProject();
    const center = 16 * project.width + 16;
    for (let y = 0; y < project.height; y += 1) for (let x = 16; x < project.width; x += 1) project.base[y * project.width + x] = 1;
    const before = slopeDegreesAt(project, 16, 16);
    const changes = applyBrushStroke(project, { tool: 'slope', centerX: 16, centerY: 16, radiusStuds: 4, strength: 1, hardness: 1, maxSlopeDegrees: 12, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(changes.some((change) => change.kind === 'height' && change.index === center)).toBe(true);
    expect(slopeDegreesAt(project, 16, 16)).toBeLessThan(before);
  });

  it('summarizes composed terrain using a bounded sample pass', () => {
    const project = testProject();
    project.base.fill(0.4);
    const stats = terrainStatistics(project);
    expect(stats.minElevation).toBeCloseTo(400);
    expect(stats.maxElevation).toBeCloseTo(400);
    expect(stats.meanSlope).toBeCloseTo(0);
    expect(stats.waterCoveragePercent).toBe(0);
    expect(stats.materialCoverage[0].percent).toBe(100);
    expect(stats.sampledPoints).toBeGreaterThan(0);
  });

  it('supports deterministic next-tier landform brushes', () => {
    const project = testProject();
    const ridgeChanges = applyBrushStroke(project, { tool: 'ridge', centerX: 16, centerY: 16, radiusStuds: 32, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(ridgeChanges.length).toBeGreaterThan(0);
    const ridgeHeight = compositeHeightAt(project, 16, 16);
    applyBrushStroke(project, { tool: 'valley', centerX: 16, centerY: 16, radiusStuds: 32, strength: 1, hardness: 1, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(compositeHeightAt(project, 16, 16)).toBeLessThan(ridgeHeight);
    project.base.fill(0.37);
    applyBrushStroke(project, { tool: 'terrace', centerX: 16, centerY: 16, radiusStuds: 16, strength: 1, hardness: 1, stepHeightStuds: 200, targetElevation: 400, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(compositeHeightAt(project, 16, 16)).toBeCloseTo(0.4, 2);
    applyBrushStroke(project, { tool: 'plateau', centerX: 16, centerY: 16, radiusStuds: 16, strength: 1, hardness: 1, targetElevation: 600, noiseScaleStuds: 100, activeLayerId: 'base', materialIndex: 0 });
    expect(compositeHeightAt(project, 16, 16)).toBeCloseTo(0.6, 1);
  });

  it('evaluates material rules deterministically', () => {
    const project = testProject();
    project.base.fill(0.85);
    const changes = evaluateMaterialRules(project, [{ id: 'snow', name: 'Snow', enabled: true, materialIndex: 12, minElevation: 800, maxElevation: null, minSlope: null, maxSlope: null, noiseAmount: 0, noiseScaleStuds: 100, priority: 1 }]);
    expect(changes.length).toBe(project.materials.length);
    expect(project.materials.every((value) => value === 12)).toBe(true);
  });

  it('keeps fully protected material samples unchanged during rule evaluation', async () => {
    const project = testProject();
    project.base.fill(0.85);
    const center = 16 * project.width + 16;
    project.materials[center] = 4;
    project.mask[center] = 0;
    const rule = { id: 'snow', name: 'Snow', enabled: true, materialIndex: 12, minElevation: 800, maxElevation: null, minSlope: null, maxSlope: null, noiseAmount: 0, noiseScaleStuds: 100, priority: 1 };
    const preview = materialMapForRules(project, [rule]);
    expect(preview[center]).toBe(4);
    const changes = await evaluateMaterialRulesAsync(project, [rule]);
    expect(project.materials[center]).toBe(4);
    expect(changes.some((change) => change.kind === 'material-bulk')).toBe(true);
  });

  it('previews material rules without mutating the project', () => {
    const project = testProject();
    project.base.fill(0.85);
    const original = project.materials.slice();
    const preview = materialMapForRules(project, [{ id: 'snow', name: 'Snow', enabled: true, materialIndex: 12, minElevation: 800, maxElevation: null, minSlope: null, maxSlope: null, noiseAmount: 0, noiseScaleStuds: 100, priority: 1 }]);
    expect(preview.every((value) => value === 12)).toBe(true);
    expect(Array.from(project.materials)).toEqual(Array.from(original));
  });

  it('evaluates large-map rules in yieldable batches with compact history', async () => {
    const project = testProject();
    project.base.fill(0.85);
    const changes = await evaluateMaterialRulesAsync(project, [{ id: 'snow', name: 'Snow', enabled: true, materialIndex: 12, minElevation: 800, maxElevation: null, minSlope: null, maxSlope: null, noiseAmount: 0, noiseScaleStuds: 100, priority: 1 }]);
    expect(changes[0].kind).toBe('material-bulk');
    expect(project.materials.every((value) => value === 12)).toBe(true);
    applyChanges(project, changes, 'before');
    expect(project.materials.every((value) => value === 0)).toBe(true);
    applyChanges(project, changes, 'after');
    expect(project.materials.every((value) => value === 12)).toBe(true);
  });

  it('paints deterministic biome materials inside a selection and respects the mask', async () => {
    const project = testProject();
    const protectedIndex = 6 * project.width + 6;
    project.mask[protectedIndex] = 0;
    const changes = await applyBiomeAsync(project, 'desert', { x0: 4, y0: 4, x1: 8, y1: 8 });
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('material-bulk');
    expect(project.materials[4 * project.width + 4]).toBe(6);
    expect(project.materials[protectedIndex]).toBe(0);
    expect(project.materials[2 * project.width + 2]).toBe(0);
  });

  it('generates deterministic preset deltas for a non-destructive layer', () => {
    const project = testProject();
    const first = generateProceduralDelta(project, { preset: 'mountains', seed: 44, scaleStuds: 180, amplitudeStuds: 520, edgeFalloff: 1.4 });
    const second = generateProceduralDelta(project, { preset: 'mountains', seed: 44, scaleStuds: 180, amplitudeStuds: 520, edgeFalloff: 1.4 });
    expect(first).toEqual(second);
    expect(first.some((value) => value !== 0)).toBe(true);
  });

  it('constrains procedural deltas to the selection and editable mask', async () => {
    const project = testProject();
    const protectedIndex = 16 * project.width + 16;
    project.mask[protectedIndex] = 0;
    const values = await generateProceduralDeltaAsync(project, { preset: 'mountains', seed: 44, scaleStuds: 180, amplitudeStuds: 520, edgeFalloff: 1.4, selection: { x0: 14, y0: 14, x1: 18, y1: 18 } });
    expect(values[protectedIndex]).toBe(0);
    expect(values[2 * project.width + 2]).toBe(0);
    expect(values.some((value) => value !== 0)).toBe(true);
  });
});
