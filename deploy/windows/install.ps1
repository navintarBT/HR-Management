# ROMEO HR - install (or re-install) on the shop's Windows server.
# One Windows service runs the API, the web app and the scanner endpoint.
#
# Run from PowerShell opened with "Run as administrator":
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
# Options: -Port 80  -MongoUri mongodb://127.0.0.1:27017/romeo-hr  -Nssm C:\nssm\nssm.exe
param(
  [int]$Port = 80,
  [string]$MongoUri = 'mongodb://127.0.0.1:27017/romeo-hr',
  [string]$Nssm = 'C:\nssm\nssm.exe',
  [string]$ServiceName = 'ROMEO-HR'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server'
$client = Join-Path $repo 'client'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Run($what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with "Run as administrator" and run this again.'
}

Step 'Checking Node.js and NSSM'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is not installed - install the LTS version from https://nodejs.org first.' }
$nodeVersion = (& node --version)
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 18) { throw "Node.js 18 or newer is required (found $nodeVersion)." }
Write-Host "Node $nodeVersion ($($node.Source))"
if (-not (Test-Path $Nssm)) { throw "NSSM not found at $Nssm - download it from https://nssm.cc and pass -Nssm <path to nssm.exe>." }

Step 'Installing server packages'
Push-Location $server
try { Run 'npm ci (server)' { npm ci --omit=dev } } finally { Pop-Location }

Step 'Building the web app'
Push-Location $client
try {
  Run 'npm ci (client)' { npm ci }
  Run 'web app build' { npm run build }
} finally { Pop-Location }

Step 'Server settings (server\.env)'
$envFile = Join-Path $server '.env'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  # ASCII on purpose: PowerShell 5's UTF-8 adds a byte-order mark that breaks the first key.
  @(
    "MONGO_URI=$MongoUri",
    "JWT_SECRET=$secret",
    'JWT_EXPIRES_IN=7d',
    "PORT=$Port",
    'APP_TZ=Asia/Vientiane',
    'CLIENT_DIST=../client/dist'
  ) | Set-Content -Path $envFile -Encoding ASCII
  Write-Host "Created $envFile with a new JWT_SECRET"
} else {
  if (-not (Get-Content $envFile | Where-Object { $_ -match '^CLIENT_DIST=' })) {
    Add-Content -Path $envFile -Value 'CLIENT_DIST=../client/dist' -Encoding ASCII
    Write-Host 'Added CLIENT_DIST to the existing .env'
  }
  Write-Host 'Kept the existing .env (secrets untouched)'
}
$portLine = Get-Content $envFile | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1
if ($portLine) { $Port = [int]($portLine -replace '^PORT=', '') }

Step "Windows service '$ServiceName'"
New-Item -ItemType Directory -Force -Path (Join-Path $server 'logs') | Out-Null
$log = Join-Path $server 'logs\server.log'
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
  & $Nssm install $ServiceName $node.Source 'src\index.js' | Out-Null
}
& $Nssm set $ServiceName Application $node.Source | Out-Null
& $Nssm set $ServiceName AppParameters 'src\index.js' | Out-Null
& $Nssm set $ServiceName AppDirectory $server | Out-Null
& $Nssm set $ServiceName DisplayName 'ROMEO HR server' | Out-Null
& $Nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $Nssm set $ServiceName AppExit Default Restart | Out-Null
& $Nssm set $ServiceName AppStdout $log | Out-Null
& $Nssm set $ServiceName AppStderr $log | Out-Null
& $Nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $Nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
if ((Get-Service -Name $ServiceName).Status -eq 'Running') { & $Nssm restart $ServiceName | Out-Null } else { & $Nssm start $ServiceName | Out-Null }

Step "Firewall (inbound TCP $Port)"
$ruleName = "ROMEO HR (TCP $Port)"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
}

Step 'Power settings (never sleep on mains power)'
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0

Step 'Checking the server answers'
$healthy = $false
for ($i = 0; $i -lt 10 -and -not $healthy; $i++) {
  Start-Sleep -Seconds 3
  try { $healthy = (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5).ok } catch { }
}
if ($healthy) { Write-Host 'Server is up.' -ForegroundColor Green } else { Write-Host "Server did not answer yet - check $log" -ForegroundColor Yellow }

$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
$portSuffix = ''
if ($Port -ne 80) { $portSuffix = ":$Port" }
Write-Host ''
Write-Host "Web app:  http://$ip$portSuffix" -ForegroundColor Green
Write-Host "Scanners (COMM > Cloud Server Setting): Server Mode ADMS, Server Address $ip, Port $Port, HTTPS off, Domain Name off" -ForegroundColor Green
