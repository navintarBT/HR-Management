# ROMEO HR - back up the database (photo evidence included) and employee
# photos into a dated folder every day. Needs MongoDB Database Tools (mongodump).
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup
# Schedule it daily (run once, as administrator):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -BackupDir D:\ROMEO-backup -Register
#
# Keeps the last -KeepDays days. When the disk is getting full it deletes the
# oldest backups first (always keeping the newest one) so today's still fits
# with -MinFreeGB to spare; if even that isn't enough it skips the day rather
# than filling the disk. What happened is written to backup.log in -BackupDir.
param(
  [string]$BackupDir = 'D:\ROMEO-backup',
  [int]$KeepDays = 30,
  [int]$MinFreeGB = 10,
  [switch]$Register,
  [string]$At = '03:30'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server'

if ($Register) {
  $script = $MyInvocation.MyCommand.Path
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupDir `"$BackupDir`" -KeepDays $KeepDays -MinFreeGB $MinFreeGB"
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  Register-ScheduledTask -TaskName 'ROMEO-HR backup' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Write-Host "Daily backup scheduled at $At into $BackupDir" -ForegroundColor Green
  return
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$logFile = Join-Path $BackupDir 'backup.log'
function Log($text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text"
  Write-Host $line
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}
function Gb([double]$bytes) { '{0:N1} GB' -f ($bytes / 1GB) }
function FreeBytes { (Get-PSDrive -Name (Get-Item $BackupDir).PSDrive.Name).Free }
function FolderBytes($dir) { [double](Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum }
# Dated backup folders, oldest first (yyyy-MM-dd_HHmm sorts by time).
function Backups { @(Get-ChildItem -Path $BackupDir -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' } | Sort-Object Name) }

$mongodump = Get-Command mongodump -ErrorAction SilentlyContinue
if ($mongodump) { $mongodump = $mongodump.Source } else {
  $found = Get-ChildItem 'C:\Program Files\MongoDB\Tools\*\bin\mongodump.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { Log 'FAILED: mongodump not found - install "MongoDB Database Tools".'; exit 1 }
  $mongodump = $found.FullName
}
$uriLine = Get-Content (Join-Path $server '.env') | Where-Object { $_ -match '^MONGO_URI=' } | Select-Object -First 1
if (-not $uriLine) { Log 'FAILED: MONGO_URI is missing from server\.env'; exit 1 }
$uri = $uriLine -replace '^MONGO_URI=', ''

# Room for today's backup: about the size of the last one (it only grows), plus
# -MinFreeGB to spare. Oldest go first; the newest is never deleted here.
$existing = Backups
$lastSize = 0
if ($existing.Count) { $lastSize = FolderBytes $existing[-1].FullName }
$needed = [double]$lastSize * 1.2 + [double]$MinFreeGB * 1GB
while ((FreeBytes) -lt $needed -and (Backups).Count -gt 1) {
  $oldest = (Backups)[0]
  Remove-Item -Path $oldest.FullName -Recurse -Force
  Log "Disk nearly full: deleted the oldest backup $($oldest.Name) (free now $(Gb (FreeBytes)))"
}
if ((FreeBytes) -lt $needed) {
  Log "WARNING: not enough disk space for a backup (free $(Gb (FreeBytes)), need about $(Gb $needed)) - skipped today. Free up space or move -BackupDir to a bigger disk."
  exit 1
}

$target = Join-Path $BackupDir (Get-Date -Format 'yyyy-MM-dd_HHmm')
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $mongodump --uri $uri --gzip --out (Join-Path $target 'db') --quiet
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Path $target -Recurse -Force -ErrorAction SilentlyContinue
  Log "FAILED: mongodump exit $LASTEXITCODE"
  exit 1
}
$uploads = Join-Path $server 'uploads'
if (Test-Path $uploads) { Copy-Item -Path $uploads -Destination (Join-Path $target 'uploads') -Recurse }

# Older than -KeepDays, once today's is safely written.
Backups | Where-Object { $_.FullName -ne $target -and $_.CreationTime -lt (Get-Date).AddDays(-$KeepDays) } | ForEach-Object {
  Remove-Item -Path $_.FullName -Recurse -Force
  Log "Deleted $($_.Name) (older than $KeepDays days)"
}
Log "Backup written to $target ($(Gb (FolderBytes $target))), $((Backups).Count) kept, free $(Gb (FreeBytes))"
