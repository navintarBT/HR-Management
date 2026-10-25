# ROMEO HR - one-time copy of the data from MongoDB Atlas into the local
# MongoDB on this server, then the employee photos from the old server.
# Needs MongoDB Database Tools (mongodump / mongorestore) and server\.env
# already pointing MONGO_URI at the local database (install.ps1 does that).
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\migrate-from-atlas.ps1 `
#     -AtlasUri "<the MONGO_URI currently set on Render>" `
#     -OldApiBase "https://<the old server>/api"
# -Overwrite replaces whatever the local database already holds (needed for a
# second run, e.g. the final copy at switch-over).
param(
  [Parameter(Mandatory = $true)][string]$AtlasUri,
  [string]$OldApiBase = '',
  [switch]$Overwrite
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server'

function Tool($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $found = Get-ChildItem "C:\Program Files\MongoDB\Tools\*\bin\$name.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $found) { throw "$name not found - install ""MongoDB Database Tools""." }
  return $found.FullName
}
$mongodump = Tool 'mongodump'
$mongorestore = Tool 'mongorestore'

$uriLine = Get-Content (Join-Path $server '.env') | Where-Object { $_ -match '^MONGO_URI=' } | Select-Object -First 1
if (-not $uriLine) { throw 'MONGO_URI is missing from server\.env - run install.ps1 first.' }
$localUri = $uriLine -replace '^MONGO_URI=', ''
$local = [Uri]$localUri
$targetDb = $local.AbsolutePath.Trim('/')
if (-not $targetDb) { throw "MONGO_URI in server\.env must name a database (e.g. mongodb://127.0.0.1:27017/romeo-hr)." }
$localBase = "$($local.Scheme)://$($local.Authority)"

$dump = Join-Path $env:TEMP ("romeo-atlas-dump-" + (Get-Date -Format 'yyyyMMdd-HHmm'))
Write-Host "Copying from Atlas into $dump ..." -ForegroundColor Cyan
& $mongodump --uri $AtlasUri --out $dump
if ($LASTEXITCODE -ne 0) { throw "mongodump failed (exit $LASTEXITCODE)" }
$sourceDb = Get-ChildItem -Path $dump -Directory | Where-Object { @('admin', 'local', 'config') -notcontains $_.Name } | Select-Object -First 1 -ExpandProperty Name
if (-not $sourceDb) { throw 'The Atlas copy is empty.' }

Write-Host "Restoring '$sourceDb' into local '$targetDb' ..." -ForegroundColor Cyan
$restoreArgs = @('--uri', $localBase, '--nsFrom', "$sourceDb.*", '--nsTo', "$targetDb.*", $dump)
if ($Overwrite) { $restoreArgs = @('--drop') + $restoreArgs }
& $mongorestore @restoreArgs
if ($LASTEXITCODE -ne 0) { throw "mongorestore failed (exit $LASTEXITCODE) - if the local database already has data, re-run with -Overwrite." }

if ($OldApiBase) {
  Write-Host 'Copying employee photos from the old server ...' -ForegroundColor Cyan
  & node (Join-Path $PSScriptRoot 'download-photos.js') $OldApiBase
  if ($LASTEXITCODE -ne 0) { throw 'Photo copy failed.' }
}
Write-Host 'Done.' -ForegroundColor Green
