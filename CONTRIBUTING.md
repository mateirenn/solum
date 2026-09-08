# Contributing to Solum

Thanks for helping improve Solum. The project is a Windows-first terrain editor, but the terrain domain and browser-compatible frontend should stay portable wherever practical.

## Before opening a pull request

1. Read the relevant document in `docs/` and inspect the existing source before changing behavior.
2. Keep the persistent terrain model as the source of truth; rendered Pixi or Three state must remain a representation.
3. Add or update focused tests for important domain, persistence, import, export, and undo behavior.
4. Run the checks below from a Windows development environment.
5. Update `docs/IMPLEMENTATION_STATUS.md` when a feature’s status or limitation changes.

```powershell
pnpm install
pnpm verify
```

For desktop changes, also run:

```powershell
pnpm tauri dev
pnpm tauri build
```

## Pull requests

Keep pull requests focused. Explain the user-visible change, the affected source-of-truth boundary, tests run, and any validation that still requires Roblox Studio or a packaged Windows installation. Do not commit `node_modules`, `dist`, `src-tauri/target`, `.pnpm-store`, or local `graphify-out` data.

## Scope and safety

Solum is intentionally local-first. Do not add accounts, telemetry, AI features, network bridges, arbitrary shell commands, or live Studio synchronization without a separately reviewed design and security boundary.

