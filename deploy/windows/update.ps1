# ROMEO HR - pull the latest code, rebuild the web app and restart the service.
# Run from PowerShell opened with "Run as administrator":
#   powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
param(
  [string]$Nssm = 'C:\nssm\nssm.exe',
  [string]$ServiceName = 'ROMEO-HR'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server'
$client = Join-Path $repo 'client'

function Run($what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

Push-Location $repo
try { Run 'git pull' { git pull --ff-only } } finally { Pop-Location }
Push-Location $server
try { Run 'npm ci (server)' { npm ci --omit=dev } } finally { Pop-Location }
Push-Location $client
try {
  Run 'npm ci (client)' { npm ci }
  Run 'web app build' { npm run build }
} finally { Pop-Location }

& $Nssm restart $ServiceName | Out-Null
$port = 80
$portLine = Get-Content (Join-Path $server '.env') | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1
if ($portLine) { $port = [int]($portLine -replace '^PORT=', '') }
$healthy = $false
for ($i = 0; $i -lt 10 -and -not $healthy; $i++) {
  Start-Sleep -Seconds 3
  try { $healthy = (Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 5).ok } catch { }
}
if ($healthy) { Write-Host 'Updated and running.' -ForegroundColor Green } else { Write-Host "Restarted but not answering yet - check $server\logs\server.log" -ForegroundColor Yellow }
