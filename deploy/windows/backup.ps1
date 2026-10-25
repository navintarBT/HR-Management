# ROMEO HR - back up the database and employee photos into a dated folder,
# keeping the last -KeepDays days. Needs MongoDB Database Tools (mongodump).
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup
# Schedule it daily (run once, as administrator):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup -Register
param(
  [string]$BackupDir = 'D:\ROMEO-backup',
  [int]$KeepDays = 30,
  [switch]$Register,
  [string]$At = '03:30'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server'

if ($Register) {
  $script = $MyInvocation.MyCommand.Path
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupDir `"$BackupDir`" -KeepDays $KeepDays"
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  Register-ScheduledTask -TaskName 'ROMEO-HR backup' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Write-Host "Daily backup scheduled at $At into $BackupDir" -ForegroundColor Green
  return
}

$mongodump = Get-Command mongodump -ErrorAction SilentlyContinue
if ($mongodump) { $mongodump = $mongodump.Source } else {
  $found = Get-ChildItem 'C:\Program Files\MongoDB\Tools\*\bin\mongodump.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw 'mongodump not found - install "MongoDB Database Tools".' }
  $mongodump = $found.FullName
}
$uriLine = Get-Content (Join-Path $server '.env') | Where-Object { $_ -match '^MONGO_URI=' } | Select-Object -First 1
if (-not $uriLine) { throw 'MONGO_URI is missing from server\.env' }
$uri = $uriLine -replace '^MONGO_URI=', ''

$target = Join-Path $BackupDir (Get-Date -Format 'yyyy-MM-dd_HHmm')
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $mongodump --uri $uri --out (Join-Path $target 'db') --quiet
if ($LASTEXITCODE -ne 0) { throw "mongodump failed (exit $LASTEXITCODE)" }
$uploads = Join-Path $server 'uploads'
if (Test-Path $uploads) { Copy-Item -Path $uploads -Destination (Join-Path $target 'uploads') -Recurse }

Get-ChildItem -Path $BackupDir -Directory |
  Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' -and $_.CreationTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Recurse -Force
Write-Host "Backup written to $target" -ForegroundColor Green
