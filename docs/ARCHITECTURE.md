# Architecture

Solum is a local desktop application: React and TypeScript own interaction state, PixiJS renders the 2D viewport, Three.js renders the sampled 3D preview, and Tauri 2 provides the Windows shell. Browser development uses download/input persistence and bounded local recovery; the Tauri runtime uses native dialogs, validated Rust project file commands, and a bounded app-data recovery file. Native file reads and atomic writes run through Tauri blocking worker threads so disk I/O does not occupy the command/UI thread. Explicit project serialization yields between tile records and exposes progress/cancellation; browser recovery remains bounded. The service boundary is kept in `src/domain/project.ts` and `src/platform/nativeProject.ts` so a native repository can replace the current JSON container without coupling storage to React components.

## Source of truth

`TerrainProject` is the source of truth. It owns high-precision sparse 256 × 256 tile buffers for base heights, signed layer deltas, material IDs, masks, project dimensions, and Roblox export settings. Empty tiles read from a typed default and direct sample writes mark their owning tile dirty. The Pixi texture and Three geometry are disposable render representations. React stores only the active tool, view mode, selection, and a revision counter.

## Data flow

```text
pointer input
  -> reusable brush operation
  -> changed-sample history entry
  -> mutable TerrainProject
  -> Pixi texture + Three sampled mesh refresh
  -> project/export serialization
```

Rules, biome painting, and procedural generation use `src/platform/terrainWorker.ts` to send a structured project snapshot to `src/workers/terrainWorker.ts`. Procedural generation uses a minimal snapshot and transfers a copy of the protection mask instead of cloning unrelated terrain and material layers; biome and rules snapshots materialize only the fields those operations read. The worker returns typed-array results; the main thread applies them to sparse `TerrainProject` buffers and records the undo entry. This keeps the persistent model on the main thread while moving the expensive read/compute pass off the UI thread. Full worker results and some analysis/export paths remain deliberate contiguous-boundary costs.

## Planned native boundary

Future native work should move tile persistence, image codecs, and large-map operations behind narrowly scoped Tauri commands. It should not expose arbitrary shell commands or a network bridge to the frontend. Native project and recovery reads/writes already run on blocking worker threads and use a same-directory temporary file, `sync_all`, and Windows atomic replacement; the current browser-compatible implementation keeps terrain math independent from Tauri APIs, while only native file selection and file I/O cross the platform boundary.
