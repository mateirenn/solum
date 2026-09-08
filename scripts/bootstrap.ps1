$ErrorActionPreference = 'SilentlyContinue'

Write-Host 'Solum Windows environment check' -ForegroundColor Cyan
$failed = $false

function Check-Command($name, $hint) {
  $command = Get-Command $name
  if ($command) { Write-Host "  [ok] $name" -ForegroundColor Green }
  else { Write-Host "  [missing] $name — $hint" -ForegroundColor Red; $script:failed = $true }
}

Check-Command 'node' 'install Node.js 20+'
Check-Command 'pnpm.cmd' 'install pnpm 9+'
Check-Command 'cargo' 'install Rust with rustup for Tauri builds'
Check-Command 'rustc' 'install the stable Rust toolchain'

$vs = Get-Command cl.exe
if ($vs) { Write-Host '  [ok] MSVC compiler' -ForegroundColor Green }
else { Write-Host '  [info] cl.exe not on PATH — run from a VS Developer PowerShell or install C++ Build Tools' -ForegroundColor Yellow }

$webview = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*' -ErrorAction SilentlyContinue | Where-Object { $_.name -match 'WebView' }
if ($webview) { Write-Host '  [ok] WebView2 registry entry' -ForegroundColor Green }
else { Write-Host '  [info] WebView2 was not detected; Windows 11 normally includes it' -ForegroundColor Yellow }

if ($failed) {
  Write-Host 'Install the missing prerequisites, reopen PowerShell, and run this check again.' -ForegroundColor Yellow
  exit 1
}
Write-Host 'Frontend prerequisites are ready. Cargo/MSVC/WebView2 determine whether pnpm tauri build can run.' -ForegroundColor Green
