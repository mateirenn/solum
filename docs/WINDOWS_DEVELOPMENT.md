# Windows development

## Install prerequisites

1. Install Node.js 20 or newer and enable Corepack, then install pnpm 9 or newer.
2. Install the stable Rust toolchain with `rustup`.
3. Install Microsoft C++ Build Tools with the Desktop development with C++ workload, Windows 10/11 SDK, and MSVC toolchain.
4. Keep WebView2 Runtime installed. Windows 11 includes it; Windows 10 may need the Evergreen Runtime installer.

Run the environment check:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1
```

## Commands

```powershell
pnpm install
pnpm dev             # browser-compatible UI
pnpm tauri dev       # Windows desktop shell
pnpm verify          # TypeScript, tests, and production frontend build
pnpm tauri build     # NSIS and MSI installers
```

Installers are written to `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/bundle/msi/`.

## Common errors

- `pnpm is not recognized`: run `corepack enable` or install pnpm directly, then open a new PowerShell.
- `link.exe` or `cl.exe` missing: reopen Visual Studio Installer and add Desktop development with C++ plus the Windows SDK.
- WebView2 errors: install or repair the Evergreen Runtime.
- Tauri cannot find Cargo: install Rust with `rustup`, restart PowerShell, and confirm `cargo --version`.
- Port 1420 is busy: stop the other Vite process; Tauri uses this fixed port by design.

## Reset build outputs

These are safe generated directories to remove from the repository root:

```powershell
Remove-Item -Recurse -Force dist, src-tauri/target -ErrorAction SilentlyContinue
```

Do not remove project files or `.rterrain` exports when resetting caches.
