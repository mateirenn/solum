# Solum

### A focused terrain authoring studio for Roblox developers

[![CI](https://github.com/mateirenn/solum/actions/workflows/ci.yml/badge.svg)](https://github.com/mateirenn/solum/actions/workflows/ci.yml)
[![Latest beta](https://img.shields.io/github/v/release/mateirenn/solum?include_prereleases&label=latest%20beta)](https://github.com/mateirenn/solum/releases)
[![Discussions](https://img.shields.io/github/discussions/mateirenn/solum?label=discussions)](https://github.com/mateirenn/solum/discussions)
[![License: MIT](https://img.shields.io/badge/license-MIT-limegreen.svg)](LICENSE)

Solum is a local-first, Windows-first terrain desk for building Roblox worlds. Work in Roblox studs, sculpt high-precision terrain, assign stable Roblox materials, inspect the result in 3D, and export a handoff package for Roblox Studio.

> **v0.8 beta** — the editor foundation is usable end to end. The beta intentionally documents the boundaries of its large-map and Studio-validation workflows instead of hiding them behind placeholder controls.

## Download

Download the Windows installers from the [v0.8 beta release](https://github.com/mateirenn/solum/releases/tag/v0.8-beta):

- **MSI** — per-machine Windows Installer package.
- **NSIS setup** — conventional Windows setup executable.

Solum does not require an account, a server, or a Roblox plugin for its core workflow. The exported heightmap, colormap, and manifest are designed to be consumed by Roblox Studio’s Terrain Editor.

## What you can do

- Create worlds from 2,048 to 16,384 studs without manually calculating sample dimensions.
- Sculpt height with raise, lower, smooth, flatten, coherent noise, terrace, ridge, valley, plateau, and slope tools.
- Work non-destructively with height layers and material coverage layers.
- Paint a focused Roblox material catalog with deterministic rules and Temperate, Alpine, or Desert biome presets.
- Use rectangle or freeform polygon selections and a grayscale protection mask to constrain edits.
- Lay out editable road corridors and river channels with width, shoulder, bank, depth, and grade controls.
- Inspect terrain in Height, Materials, Combined, Slope, or Mask views alongside a sampled Three.js preview.
- Save and reopen portable `.rterrain` projects, including migration from the original v1 format.
- Export a conservative Roblox handoff package: heightmap PNG, colormap PNG, and mapping manifest JSON.
- Keep heavy procedural, biome, rule, and export preparation work off the UI thread with progress and cancellation.

## Quick start for development

### Prerequisites

- Windows 10/11 with WebView2.
- Node.js 20 or newer and pnpm 9 or newer.
- Rust stable, Microsoft C++ Build Tools, and the Windows 10/11 SDK for the desktop shell.

See the complete [Windows development guide](docs/WINDOWS_DEVELOPMENT.md), then run:

```powershell
pnpm install
pnpm tauri dev
```

For browser-compatible frontend development only:

```powershell
pnpm dev
```

## Validate and build

```powershell
pnpm verify
pnpm tauri build
```

`pnpm verify` runs TypeScript checks, the deterministic Vitest suite, the production Vite build, and Rust tests when Cargo is available. `pnpm tauri build` produces the NSIS and MSI packages under `src-tauri/target/release/bundle/`.

## Roblox handoff

1. Create a project using Roblox-stud dimensions.
2. Sculpt and inspect the terrain in Solum.
3. Choose **Export → Create export package**.
4. Import the heightmap through Roblox Studio’s Terrain Editor.
5. Use the colormap and manifest to preserve the intended Roblox material identities.

Solum’s source of truth is the `.rterrain` project model. PNGs are output representations: grayscale height is created only at export, while material identity is recorded as explicit RGB-to-Roblox mappings in the manifest.

## Project and architecture

- [Architecture](docs/ARCHITECTURE.md) — runtime boundaries and data flow.
- [Project format](docs/PROJECT_FORMAT.md) — versioned tiled `.rterrain` contract.
- [Terrain model](docs/TERRAIN_MODEL.md) — normalized heights, layers, materials, and scale.
- [Implementation status](docs/IMPLEMENTATION_STATUS.md) — factual feature status, tests, limitations, and next steps.
- [Roadmap](docs/ROADMAP.md) — prioritized follow-up work.
- [Roblox validation notes](docs/ROBLOX_VALIDATION.md) — what still needs a recorded Studio import run.

The future `apps/roblox-plugin` directory is deliberately only a contract placeholder. Core Solum does not start a local control server or claim live Studio synchronization.

## Beta boundaries

The current release is functional but deliberately limited in a few production areas: native incremental dirty-tile storage, Rust-backed large-map processing, sustained 4,096 × 4,096 profiling, packaged clean-machine QA, and recorded Roblox Studio acceptance. Reusable stamps, advanced spline snapping, and a full material authoring system remain roadmap work. See the [status table](docs/IMPLEMENTATION_STATUS.md) before relying on any specific workflow at scale.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Changes should keep the terrain domain as the source of truth, preserve explicit types, add focused tests for important behavior, and update the status documentation when a feature’s boundary changes.

Questions and workflow ideas belong in [Discussions](https://github.com/mateirenn/solum/discussions); reproducible bugs and scoped proposals belong in [Issues](https://github.com/mateirenn/solum/issues). See [SUPPORT.md](.github/SUPPORT.md) for the community support path and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

If Solum is useful to your work, you can [support the project on GitHub Sponsors](https://github.com/sponsors/mateirenn). Sponsorship availability depends on the maintainer’s GitHub Sponsors enrollment.

## License

Solum is released under the permissive [MIT License](LICENSE).
