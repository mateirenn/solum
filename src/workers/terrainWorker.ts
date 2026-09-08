import {
  BiomeId,
  materialMapForBiomeAsync,
  materialMapForRulesAsync,
  MaterialRule,
  ProceduralOptions,
  SelectionRegion,
  TerrainProject,
  generateProceduralDeltaAsync,
} from '../domain/terrain';

type WorkerRequest = {
  id: number;
  operation: 'rules' | 'biome' | 'procedural';
  project: TerrainProject;
  rules?: MaterialRule[];
  biome?: BiomeId;
  selection?: SelectionRegion | null;
  procedural?: ProceduralOptions;
};

type WorkerPort = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const worker = globalThis as unknown as WorkerPort;

worker.onmessage = (event) => {
  void run(event.data);
};

async function run(request: WorkerRequest): Promise<void> {
  const onProgress = (progress: number) => worker.postMessage({ id: request.id, type: 'progress', progress });
  try {
    let result: Uint8Array | Float32Array;
    if (request.operation === 'rules') {
      result = await materialMapForRulesAsync(request.project, request.rules ?? [], onProgress);
    } else if (request.operation === 'biome') {
      if (!request.biome) throw new Error('Biome operation is missing its preset.');
      result = await materialMapForBiomeAsync(request.project, request.biome, request.selection, onProgress);
    } else {
      if (!request.procedural) throw new Error('Procedural operation is missing its settings.');
      result = await generateProceduralDeltaAsync(request.project, request.procedural, onProgress);
    }
    worker.postMessage({ id: request.id, type: 'result', dataType: result instanceof Uint8Array ? 'uint8' : 'float32', buffer: result.buffer }, [result.buffer]);
  } catch (error) {
    worker.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : 'Terrain worker failed.' });
  }
}
