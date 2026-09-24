#Requires -RunAsAdministrator
<#
  DataCare Softech – Invoice & Quotation : Windows server installer

  Run from an elevated PowerShell (Run as Administrator) inside the copied folder:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\install.ps1                                   # LAN only  ->  http://<server-ip>:3000
      .\install.ps1 -Domain api.datacaresoftech.com   # + public HTTPS via Caddy (needs DNS A record + ports 80/443 open)

  What it does
    1. copies the app to C:\DataCareInvoice
    2. installs Node.js LTS if missing, then the server dependencies
    3. opens the firewall port(s)
    4. registers a scheduled task "DataCareInvoiceAPI" that starts the backend at boot (auto-restart, log file)
    5. with -Domain: downloads caddy.exe, writes the Caddyfile, registers "DataCareCaddy" for automatic HTTPS
  Safe to run again: it updates files and restarts the services.
#>
param(
  [string]$InstallPath = "C:\DataCareInvoice",
  [string]$Domain = "",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# ---------- 1. files ----------
Step "Copying files to $InstallPath"
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
$rc = (Start-Process robocopy -ArgumentList @("`"$src`"", "`"$InstallPath`"", "/E", "/XD", "node_modules", ".git", ".vercel", "/XF", "install.ps1", "*.zip", "/NFL", "/NDL", "/NJH", "/NJS", "/NP") -Wait -PassThru -NoNewWindow).ExitCode
if ($rc -ge 8) { throw "File copy failed (robocopy exit code $rc)" }
$serverDir = Join-Path $InstallPath "server"

if (-not (Test-Path (Join-Path $serverDir ".env"))) {
  Copy-Item (Join-Path $serverDir ".env.example") (Join-Path $serverDir ".env")
  Write-Warning "server\.env was missing – created from .env.example. Fill in DB_SERVER / DB_USER / DB_PASSWORD in $serverDir\.env and run this script again."
  exit 1
}

# ---------- 2. Node.js ----------
Step "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found – installing LTS..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Null
  } else {
    $msi = Join-Path $env:TEMP "node-lts.msi"
    Invoke-WebRequest "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi" -OutFile $msi
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  }
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js was installed but is not on PATH yet. Close this window, open a new Administrator PowerShell and run the script again." }
}
$nodeExe = $node.Source
Write-Host "Node $(& $nodeExe -v)  ($nodeExe)"

Step "Installing server dependencies"
Push-Location $serverDir
try { & npm install --omit=dev --no-audit --no-fund --loglevel=error } finally { Pop-Location }

# ---------- 3. firewall ----------
Step "Windows Firewall"
foreach ($p in @($Port) + $(if ($Domain) { @(80, 443) } else { @() })) {
  $name = "DataCare Invoice ($p)"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Any | Out-Null
  Write-Host "Inbound TCP $p allowed"
}

# ---------- 4. backend as a scheduled task (starts at boot, restarts if it crashes, logs to server.log) ----------
Step "Registering backend service task 'DataCareInvoiceAPI'"
$log = Join-Path $serverDir "server.log"
$action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$nodeExe`" server.js >> `"$log`" 2>&1`"" -WorkingDirectory $serverDir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
Stop-ScheduledTask -TaskName "DataCareInvoiceAPI" -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodeExe } | Stop-Process -Force -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "DataCareInvoiceAPI" -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName "DataCareInvoiceAPI"

# ---------- 5. optional HTTPS with Caddy ----------
if ($Domain) {
  Step "Caddy – automatic HTTPS for https://$Domain"
  $caddy = Join-Path $InstallPath "caddy.exe"
  if (-not (Test-Path $caddy)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://caddyserver.com/api/download?os=windows&arch=amd64" -OutFile $caddy
  }
  $caddyfile = Join-Path $InstallPath "Caddyfile"
  Set-Content -Path $caddyfile -Value "$Domain {`n    encode gzip`n    reverse_proxy 127.0.0.1:$Port`n}`n" -Encoding ASCII
  $caction = New-ScheduledTaskAction -Execute $caddy -Argument "run --config `"$caddyfile`"" -WorkingDirectory $InstallPath
  Stop-ScheduledTask -TaskName "DataCareCaddy" -ErrorAction SilentlyContinue
  Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName "DataCareCaddy" -Action $caction -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName "DataCareCaddy"
}

# ---------- 6. check ----------
Step "Checking the backend"
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { $h = Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5; if ($h.ok) { $ok = $true } } catch { }
}
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress

Write-Host ""
if ($ok) {
  Write-Host "Backend is running.  Database: $($h.database)" -ForegroundColor Green
  Write-Host "  On this server : http://localhost:$Port"
  if ($ip) { Write-Host "  On the LAN     : http://${ip}:$Port" }
  if ($Domain) {
    Write-Host "  Public HTTPS   : https://$Domain   (certificate is issued on first request – allow ~30 s; DNS must already point here)"
    Write-Host ""
    Write-Host "Next: in the repo set js/config.js -> apiBase: 'https://$Domain', push, and make sure server\.env ALLOWED_ORIGINS contains your Vercel address." -ForegroundColor Yellow
  }
} else {
  Write-Warning "The backend did not answer on port $Port. Check the log: $log"
  if (Test-Path $log) { Get-Content $log -Tail 20 }
}
Write-Host ""
Write-Host "Manage: Task Scheduler -> 'DataCareInvoiceAPI'" + $(if ($Domain) { " / 'DataCareCaddy'" }) + "   |   Log: $log"
