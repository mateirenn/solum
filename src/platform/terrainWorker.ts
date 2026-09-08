import type { BiomeId, MaterialRule, ProceduralOptions, SelectionRegion, TerrainProject } from '../domain/terrain';
import { toFloat32Array, toUint8Array } from '../domain/tileBuffer';

type WorkerOperation = 'rules' | 'biome' | 'procedural';
type WorkerResponse =
  | { id: number; type: 'progress'; progress: number }
  | { id: number; type: 'result'; dataType: 'uint8' | 'float32'; buffer: ArrayBuffer }
  | { id: number; type: 'error'; message: string };

let nextRequestId = 1;

function proceduralWorkerProject(project: TerrainProject): { project: TerrainProject; transfers: Transferable[] } {
  const mask = toFloat32Array(project.mask);
  return {
    project: { ...project, base: new Float32Array(0), layers: [], materials: new Uint8Array(0), materialLayers: [], mask },
    transfers: [mask.buffer],
  };
}

function materialWorkerProject(project: TerrainProject): { project: TerrainProject; transfers: Transferable[] } {
  const base = toFloat32Array(project.base);
  const materials = toUint8Array(project.materials);
  const mask = toFloat32Array(project.mask);
  const layers = project.layers.map((layer) => ({ ...layer, values: toFloat32Array(layer.values) }));
  return {
    project: { ...project, base, layers, materials, materialLayers: [], mask },
    transfers: [base.buffer, materials.buffer, mask.buffer, ...layers.map((layer) => layer.values.buffer)],
  };
}

export function runTerrainWorker(operation: 'rules', project: TerrainProject, options: { rules: MaterialRule[] }, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Uint8Array>;
export function runTerrainWorker(operation: 'biome', project: TerrainProject, options: { biome: BiomeId; selection?: SelectionRegion | null }, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Uint8Array>;
export function runTerrainWorker(operation: 'procedural', project: TerrainProject, options: { procedural: ProceduralOptions }, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Float32Array>;
export function runTerrainWorker(operation: WorkerOperation, project: TerrainProject, options: Record<string, unknown>, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<Uint8Array | Float32Array> {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Background terrain processing is unavailable in this runtime.'));
  const worker = new Worker(new URL('../workers/terrainWorker.ts', import.meta.url), { type: 'module' });
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => finish(() => reject(new DOMException('Background terrain operation cancelled.', 'AbortError')));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.type === 'progress') {
        onProgress?.(response.progress);
      } else if (response.type === 'error') {
        finish(() => reject(new Error(response.message)));
      } else {
        const value = response.dataType === 'uint8' ? new Uint8Array(response.buffer) : new Float32Array(response.buffer);
        finish(() => resolve(value));
      }
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'Background terrain worker failed.')));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    const snapshot = operation === 'procedural' ? proceduralWorkerProject(project) : materialWorkerProject(project);
    worker.postMessage({ id, operation, project: snapshot.project, ...options }, snapshot.transfers);
  });
}
