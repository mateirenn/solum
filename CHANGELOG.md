# Changelog

All notable changes to Solum are documented here.

## v0.8 beta — 2026-09-08

The first public beta of the Windows-first Roblox terrain authoring studio.

### Added

- Roblox-stud project creation from 2,048 to 16,384 studs.
- PixiJS 2D terrain viewport with pan, zoom, coordinates, grid, brush preview, and view modes.
- Height sculpting, deterministic procedural terrain, non-destructive height layers, undo/redo, and protection masks.
- Roblox material painting, material layers, deterministic rules, biome presets, slope analysis, and sampled 3D preview.
- Editable road and river corridors with persistent metadata and undoable terrain/material changes.
- Versioned tiled `.rterrain` persistence with v1 migration and bounded local recovery.
- Heightmap, colormap, and manifest import/export workflows.
- Tauri 2 Windows shell with native dialogs, atomic project writes, NSIS packaging, and MSI packaging.
- Focused domain tests, Rust persistence tests, worker-backed heavy operations, and public-repository CI/release workflows.

### Known beta limits

- Native incremental tile storage and Rust-backed large-map processing are not yet implemented.
- Full sustained 4,096 × 4,096 profiling, clean-machine installation QA, and Roblox Studio acceptance still need recorded validation.
- Reusable stamps, advanced spline snapping, and a fully exhaustive material authoring system remain roadmap items.
