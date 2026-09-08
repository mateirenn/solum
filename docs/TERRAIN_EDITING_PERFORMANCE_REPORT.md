# Terrain editing performance report

Date: 2026-09-08

## Executive conclusion

The reported lag is credible on the current architecture and is not primarily evidence that a Radeon 780M is too weak. A brush drag currently stacks terrain computation, undo capture, React state updates, CPU bitmap generation, GPU texture replacement, and full Three.js preview reconstruction on the UI thread. Several of those costs happen once per animation frame; brush computation can happen several times within a single pointer event.

The highest-value solution is a two-speed editor:

1. During a stroke, mutate only the affected terrain tiles, update only the corresponding 2D GPU tiles, and update an existing low-resolution 3D mesh at a capped interactive rate.
2. When the stroke ends or the pointer is idle, perform the higher-quality 3D/normals/material refresh and compact the undo transaction.

This retains a live 3D preview on inexpensive hardware. Disabling the preview should be a user-selectable fallback, not the primary fix.

## Evidence from the current implementation

### P0: the 3D preview is reconstructed on every render revision

`TerrainPreview` has an effect keyed by `revision`. On every coalesced terrain edit it disposes and removes the prior terrain geometry/material and water geometry/material, traverses and disposes the scale-reference meshes, allocates new position and color arrays, allocates indices, samples the project again, creates many `THREE.Color` objects, recomputes all vertex normals, and recreates the terrain, water, grid, and mannequin (`src/components/TerrainPreview.tsx:81-169`).

Although the terrain mesh is bounded to 72 x 72 vertices, the repeated allocation, shader/resource churn, normal computation, and GPU upload happen on the main thread while pointer input is active. This is unnecessary: topology, X/Z positions, indices, material, water, grid, and reference geometry are stable during ordinary sculpting.

The renderer also runs continuously via `requestAnimationFrame`, even when the camera and terrain are unchanged (`src/components/TerrainPreview.tsx:61-67`). That consumes shared memory bandwidth and GPU time on an integrated GPU during the exact period in which terrain editing also needs CPU and GPU resources.

### P0: a small 2D CPU patch still causes texture destruction and recreation

The code correctly limits bitmap calculation to a dirty rectangle (`src/render/terrainBitmap.ts:42-85`). Immediately afterward, however, `TerrainViewport` removes the existing sprite, destroys its texture, calls `Texture.from(canvas)`, creates a new sprite, and reattaches it (`src/components/TerrainViewport.tsx:113-131`). This defeats most of the rendering benefit of dirty-region calculation and can force a complete canvas texture upload and resource churn for every revision.

PixiJS supports retaining the texture and notifying its source after the canvas changes. A stronger long-term design is one Pixi texture per terrain tile so only dirty 256 x 256 tiles are regenerated and uploaded.

### P0: pointer input can perform multiple synchronous brush stamps before yielding

While painting, every pointer move interpolates the path and calls `onBrush` once per step in a synchronous loop (`src/components/TerrainViewport.tsx:270-286`). Each call immediately runs `applyBrushStroke`, merges every changed sample into stroke history, updates dirty state, derives a dirty region by revisiting the changes, and schedules rendering (`src/App.tsx:538-559`).

Coalescing the render revision to one animation frame is good, but it does not coalesce brush computation. Fast pointer movement, a large brush, or a backlog of pointer events can therefore exceed the 16.7 ms frame budget before the browser gets a chance to paint.

### P1: the brush inner loop pays high JavaScript overhead per sample

`applyBrushStroke` visits the brush bounding square, computes distance/falloff, reads the mask, composes height layers, applies tool math, writes through a proxy-backed tiled buffer, and creates an object for every changed sample (`src/domain/terrain.ts:441-546`). Smooth invokes nine composed-height reads per affected sample; slope invokes four neighbor reads. Each composed read iterates visible layers (`src/domain/terrain.ts:342-348`), and sparse numeric access passes through a JavaScript `Proxy` into tile-coordinate arithmetic.

For the maximum 2,048-stud brush, the radius is 512 terrain samples and the bounding square contains about 1.05 million candidates per stamp. A circular test still leaves about 824,000 affected candidates. Smooth can therefore require millions of proxied layer reads for one stamp, before bitmap or 3D work begins.

### P1: undo and dirty-region capture allocate and revisit sample-level changes

Every changed sample creates an `EditChange` object. `paintAt` then constructs string keys and copies changes into a `Map`; `regionForChanges` loops over the same changes again (`src/App.tsx:76-91`, `src/App.tsx:538-559`). This is accurate but allocation-heavy, creates garbage-collection pressure, and scales with brush area rather than tile count.

### P2: both renderers use high-DPI caps simultaneously

Pixi and Three each cap device pixel ratio at 2. On a high-DPI display, each preview may render up to four physical pixels per CSS pixel. This is not the main mutation cost, but it amplifies GPU bandwidth pressure on an iGPU and should be part of an adaptive quality policy.

## Recommended implementation plan

### Phase 1: remove avoidable renderer churn

Expected impact: large improvement with relatively low implementation risk.

- Build the Three.js scene and stable mesh topology once per project dimension/quality tier. Keep typed position/color attributes and update their arrays in place. Mark attributes `DynamicDrawUsage`, add update ranges where practical, and set `needsUpdate` rather than disposing the mesh.
- Do not recreate the water, grid, material, or scale reference during a normal brush revision. Update only terrain Y values/colors; update the water height only if sea level changes.
- Replace per-vertex `new THREE.Color(...)` calls with a precomputed material RGB lookup table and numeric interpolation.
- Retain the Pixi sprite and canvas texture. After `putImageData`, call the existing texture source's update method. Measure whether the backend still uploads the whole canvas; if so, proceed immediately to tiled textures.
- Render the 3D view on demand. Request a frame on controls change, resize, or terrain update; continue frames only while OrbitControls damping is active. Cap interactive terrain refresh to 15-20 Hz and issue an immediate final refresh on stroke end.
- Add an automatic interactive-quality mode: while painting, use a 36-48 squared 3D sample grid, no antialiasing on low-tier devices, and pixel ratio 1.0-1.25. Restore the chosen idle quality after 100-200 ms of inactivity.

Acceptance target: on a 4,096 x 4,096 project with a 128-stud raise brush, renderer work should not create new terrain geometry, materials, sprites, or textures during a stroke; median input-to-display latency should remain below 50 ms on the target 780M machine.

### Phase 2: make brush work frame-budgeted

Expected impact: the largest responsiveness improvement for large and expensive brushes.

- Collect pointer samples and process them from one scheduler, rather than executing every interpolated stamp directly inside `pointermove`. Use browser coalesced events where available, append positions to a stroke path, and consume a bounded amount of work per frame.
- Resample the entire stroke path at deterministic spacing so dropping redundant pointer events does not create gaps or change final terrain output.
- Establish an interactive CPU budget (for example 6-8 ms per frame). If a stamp exceeds it, split work by dirty tile/scanline and continue next frame. The cursor remains responsive while terrain catches up by a bounded amount.
- For smooth, slope, and other neighborhood tools, read from a stable source tile plus a one-sample halo and write to a destination tile. This avoids order-dependent feedback within a stamp and permits parallel/tiled processing.
- Move large brush stamps to a worker or Rust command only after defining a tile transaction protocol. Do not transfer/clone the whole project for each pointer event. Send affected tiles plus halo, tool parameters, and stroke sequence; return changed tile buffers and compact undo data.

Acceptance target: no individual main-thread terrain task over 8 ms in the common case and none over 50 ms for supported maximum brushes; pointer events and camera interaction must remain responsive while a large stroke is processing.

### Phase 3: use the existing 256 x 256 tile model end to end

Expected impact: makes performance scale with the edited region instead of map size.

- Replace the single 768-pixel CPU bitmap texture with a grid/atlas of Pixi tile textures. Regenerate and upload only tile keys dirtied by the terrain model. Keep cursor, selection, grid, and spline overlays independent.
- Expose direct tile views/accessors for hot operations. Avoid numeric Proxy access and repeated index-to-tile coordinate calculation inside brush inner loops.
- Track dirty bounds while applying the brush instead of reconstructing them from the full change list.
- Store undo as tile-local runs or before/after typed-array patches. Keep the existing semantic transaction boundary (one history entry per stroke) while eliminating one object and one string key per sample.
- Maintain a cached composed-height tile for each visible layer-stack revision. Invalidate only affected tiles when a layer changes. Smooth/slope then read one contiguous composed buffer instead of recomposing every neighbor across every layer.

Acceptance target: editing one tile should allocate and upload O(1 tile) data regardless of whether the overall project is 1,024 squared or 4,096 squared.

### Phase 4: optional GPU/native acceleration

Only pursue this after Phases 1-3 are profiled; those phases remove work rather than merely executing waste faster.

- GPU brush compute (WebGPU compute or render-to-texture) can make simple raise/lower/flatten/noise operations extremely fast, but complicates authoritative CPU state, undo, persistence, and WebView2 compatibility.
- A Rust SIMD/tiled worker is a safer cross-device path for smooth, slope, imports, analysis, and large brushes. It still needs asynchronous tile transactions so IPC and serialization do not replace computation as the bottleneck.
- Keep a CPU fallback and capability tiers. The product goal should be stable latency on modest hardware, not a mandatory modern GPU feature.

## Adaptive performance policy

Use measured behavior rather than identifying hardware by model name.

- Run a short, non-destructive startup calibration or collect the first few edit timings.
- Quality tier inputs: long-task frequency, 2D upload time, 3D update time, frame time, device pixel ratio, viewport pixel count, and WebGL renderer capabilities.
- Degrade in this order: 3D update frequency, 3D sample density, preview pixel ratio, antialiasing, then temporarily pause live 3D during a stroke. Never reduce terrain data fidelity or final export quality.
- Provide settings for `Auto`, `Quality`, and `Performance`, plus a clear `Pause live 3D while sculpting` switch.

## Instrumentation required before and during implementation

Add User Timing marks around:

- pointer-path intake and queued point count;
- brush compute, broken down by tool, radius, affected samples, active layers, and tile count;
- history/undo capture;
- dirty bitmap CPU generation;
- Pixi texture update/upload proxy time;
- 3D sampling, normals, attribute upload, and render;
- complete input-to-visible-frame latency.

Record p50, p95, and maximum duration, plus `PerformanceObserver` long tasks. In development expose a small diagnostics overlay with FPS, queued stroke points, dirty tiles, brush ms, 2D ms, 3D update ms, and renderer draw-call/triangle counts. Measure production builds in the packaged Tauri app; development React/Vite timing is not sufficient evidence.

## Benchmark matrix

Test at 1,024, 2,048, and 4,096 samples square; radii 32, 128, 512, and 2,048 studs; raise, flatten, smooth, slope, and paint; zero, one, and four visible layers; 100%, 125%, and 150% Windows scaling; 2D-only, live 3D, and orbit-while-sculpting cases.

Primary target hardware: Ryzen 7 8840HS / Radeon 780M. Include one lower tier (older integrated Intel or Vega-class system) and one discrete GPU to distinguish CPU/main-thread limits from GPU limits.

Release gates:

- no visible cursor freeze during a normal 128-stud stroke;
- p95 input-to-2D feedback below 50 ms on target hardware;
- p95 frame time below 33 ms while sculpting in Auto mode;
- no task above 100 ms in the normal-brush matrix;
- bounded memory growth across a continuous 60-second stroke;
- identical deterministic terrain/export results before and after optimization.

## Prioritized backlog

| Priority | Work | Confidence | Why |
| --- | --- | --- | --- |
| P0 | Persist and mutate the Three.js mesh instead of rebuilding the scene representation | High | Directly confirmed source behavior; removes repeated allocation/disposal and GPU resource churn |
| P0 | Retain the Pixi texture; then implement dirty tile textures if uploads remain full-size | High | Current dirty CPU patch is followed by texture destruction/recreation |
| P0 | Queue/resample strokes and enforce a per-frame compute budget | High | Current pointer handler synchronously runs every interpolated stamp |
| P0 | Add profiling and low-end acceptance gates | High | Current docs acknowledge sustained profiling is unproven |
| P1 | On-demand/capped 3D rendering and adaptive interactive quality | High | Continuous full-rate rendering competes with edits without adding visual value while idle |
| P1 | Direct tile hot loops and cached composed tiles | High | Proxy access and repeated layer composition are inside sample/neighborhood loops |
| P1 | Compact tile/run-based undo and inline dirty-bound accumulation | High | Current per-sample objects, strings, Map entries, and second region scan create GC pressure |
| P2 | Tiled worker or Rust brush service for large/neighborhood brushes | Medium-high | Valuable after transaction granularity avoids full-project transfer costs |
| P3 | WebGPU brush compute | Medium | Potentially fast, but higher compatibility/state-management risk and not needed for the first major gain |

## What is proven and what is not

Proven from source: full 3D reconstruction per revision, continuous 3D rendering, Pixi texture recreation, synchronous interpolated stamps, per-sample history objects, proxy-backed sparse access, and repeated layer composition.

Not yet proven by a runtime trace: the percentage of time attributable to brush math versus Pixi upload versus 3D reconstruction on the user's exact machine. The ordering above is based on confirmed unnecessary work and algorithmic scaling; instrumentation is the first implementation task so results can be validated rather than guessed.

## External API guidance used

- Three.js `BufferAttribute` supports dynamic usage, `needsUpdate`, and update ranges for repeatedly changed attribute arrays: https://threejs.org/docs/pages/BufferAttribute.html
- Three.js exposes renderer information and recommends `setAnimationLoop`; renderer pixel ratio and antialiasing directly affect drawing-buffer work: https://threejs.org/docs/pages/WebGLRenderer.html
- PixiJS documents updating a retained texture source after its canvas/resource changes: https://pixijs.download/v8.14.1/docs/rendering.Texture.html
- `OffscreenCanvas` is available to workers and can move canvas work off the main thread, subject to the actual WebView2/runtime capability: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

