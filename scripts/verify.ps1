$ErrorActionPreference = 'Stop'

Write-Host 'Solum verification' -ForegroundColor Cyan
$bin = Join-Path $PSScriptRoot '..\node_modules\.bin'
$tsc = Join-Path $bin 'tsc.cmd'
$vitest = Join-Path $bin 'vitest.cmd'
$vite = Join-Path $bin 'vite.cmd'
if (-not (Test-Path -LiteralPath $tsc) -or -not (Test-Path -LiteralPath $vitest) -or -not (Test-Path -LiteralPath $vite)) {
  Write-Host 'Dependencies are missing. Run pnpm install first.' -ForegroundColor Red
  exit 1
}
& $tsc --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $vitest run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $vite build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$cargoPath = (Get-Command cargo -ErrorAction SilentlyContinue).Source
if (-not $cargoPath) {
  $userCargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
  if (Test-Path -LiteralPath $userCargo) { $cargoPath = $userCargo }
}
if ($cargoPath) {
  Push-Location src-tauri
  & $cargoPath test
  $cargoExit = $LASTEXITCODE
  Pop-Location
  if ($cargoExit -ne 0) { exit $cargoExit }
} else {
  Write-Host 'Cargo not found; Rust verification skipped. Install Rust to validate the Tauri shell.' -ForegroundColor Yellow
}

Write-Host 'Verification complete.' -ForegroundColor Green
