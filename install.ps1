#Requires -RunAsAdministrator
<#
  DataCare Softech - Invoice & Quotation : Windows server installer

  Run from an elevated PowerShell (Run as Administrator) inside the copied folder:

      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\install.ps1                                   # LAN only  ->  http://<server-ip>:3000
      .\install.ps1 -Domain api.datacaresoftech.com   # public HTTPS via Caddy (DNS A record -> this server, ports 80/443 open)
      .\install.ps1 -Port 3100                        # use another port if 3000 is taken

  What it does
    1. copies the app to C:\DataCareInvoice
    2. installs Node.js LTS if missing, then the server dependencies
    3. opens the firewall port(s)
    4. registers a scheduled task "DataCareInvoiceAPI" that starts at boot and restarts the backend if it stops
    5. with -Domain: downloads caddy.exe and registers "DataCareCaddy" for automatic HTTPS
  Safe to run again: it updates the files and restarts only its own processes.
#>
param(
  [string]$InstallPath = "C:\DataCareInvoice",
  [string]$Domain = "",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster on Windows PowerShell 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $InstallPath "server"
$serverJs = Join-Path $serverDir "server.js"
$runner = Join-Path $serverDir "run-server.cmd"
$log = Join-Path $serverDir "server.log"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# Stops only processes started by this app (never other Node / Caddy programs on the server).
function Stop-OurProcesses {
  Stop-ScheduledTask -TaskName "DataCareInvoiceAPI" -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName "DataCareCaddy" -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -eq "cmd.exe"   -and $_.CommandLine -like "*$runner*") -or
    ($_.Name -eq "node.exe"  -and $_.CommandLine -like "*$serverJs*") -or
    ($_.Name -eq "caddy.exe" -and $_.ExecutablePath -eq (Join-Path $InstallPath "caddy.exe"))
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# ---------- 1. files ----------
Step "Copying files to $InstallPath"
Stop-OurProcesses
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
if ((Resolve-Path $src).Path.TrimEnd('\') -ne (Resolve-Path $InstallPath).Path.TrimEnd('\')) {
  & robocopy $src $InstallPath /E /XD node_modules .git .vercel /XF install.ps1 *.zip *.log /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "File copy failed (robocopy exit code $LASTEXITCODE)" }
}
$envFile = Join-Path $serverDir ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $serverDir ".env.example") $envFile
  Write-Warning "server\.env was missing - created from .env.example. Fill in DB_SERVER / DB_USER / DB_PASSWORD in $envFile and run this script again."
  exit 1
}

# PORT / HOST in .env follow the parameters: behind Caddy, Node listens only on 127.0.0.1
function Set-EnvValue($key, $value) {
  $lines = Get-Content $envFile
  if ($lines -match "^$key=") { $lines = $lines -replace "^$key=.*", "$key=$value" } else { $lines += "$key=$value" }
  Set-Content -Path $envFile -Value $lines -Encoding ASCII
}
Set-EnvValue "PORT" $Port
Set-EnvValue "HOST" $(if ($Domain) { "127.0.0.1" } else { "0.0.0.0" })
Set-EnvValue "TRUST_PROXY" $(if ($Domain) { "true" } else { "false" })

# ---------- port check ----------
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy.OwningProcess)" -ErrorAction SilentlyContinue
  throw "Port $Port is already used by '$($owner.Name)' (PID $($busy.OwningProcess)). Run again with another port, e.g.  .\install.ps1 -Port 3100"
}

# ---------- 2. Node.js ----------
Step "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found - installing Node.js 20 LTS..."
  $msi = Join-Path $env:TEMP "node-lts.msi"
  Invoke-WebRequest "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi" -OutFile $msi -UseBasicParsing
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Node.js installer failed (exit code $($p.ExitCode))" }
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js was installed but is not on PATH yet. Open a new Administrator PowerShell and run the script again." }
}
$nodeExe = $node.Source
Write-Host "Node $(& $nodeExe -v)  ($nodeExe)"

Step "Installing server dependencies"
Push-Location $serverDir
try {
  & npm install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit code $LASTEXITCODE)" }
} finally { Pop-Location }

# ---------- 3. firewall ----------
Step "Windows Firewall"
$ports = if ($Domain) { @(80, 443) } else { @($Port) }
Get-NetFirewallRule -DisplayName "DataCare Invoice (*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
foreach ($p in $ports) {
  New-NetFirewallRule -DisplayName "DataCare Invoice ($p)" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow -Profile Any | Out-Null
  Write-Host "Inbound TCP $p allowed"
}

# ---------- 4. backend: runner loop (restarts after a crash) + scheduled task (starts at boot) ----------
Step "Registering backend task 'DataCareInvoiceAPI'"
Set-Content -Path $runner -Encoding ASCII -Value @"
@echo off
cd /d "$serverDir"
:loop
echo [%date% %time%] starting backend >> "$log"
"$nodeExe" "$serverJs" >> "$log" 2>&1
echo [%date% %time%] backend stopped (exit %errorlevel%), restarting in 5 s >> "$log"
timeout /t 5 /nobreak > nul
goto loop
"@
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$runner`"" -WorkingDirectory $serverDir
Register-ScheduledTask -TaskName "DataCareInvoiceAPI" -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName "DataCareInvoiceAPI"

# ---------- 5. optional HTTPS with Caddy ----------
if ($Domain) {
  Step "Caddy - automatic HTTPS for https://$Domain"
  $caddy = Join-Path $InstallPath "caddy.exe"
  if (-not (Test-Path $caddy)) {
    Invoke-WebRequest "https://caddyserver.com/api/download?os=windows&arch=amd64" -OutFile $caddy -UseBasicParsing
  }
  $caddyfile = Join-Path $InstallPath "Caddyfile"
  Set-Content -Path $caddyfile -Encoding ASCII -Value "$Domain {`n    encode gzip`n    reverse_proxy 127.0.0.1:$Port`n}"
  $caction = New-ScheduledTaskAction -Execute $caddy -Argument "run --config `"$caddyfile`"" -WorkingDirectory $InstallPath
  $csettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName "DataCareCaddy" -Action $caction -Trigger $trigger -Settings $csettings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName "DataCareCaddy"
}

# ---------- 6. check ----------
Step "Checking the backend"
$ok = $false; $h = $null
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 -UseBasicParsing; if ($h.ok) { $ok = $true } } catch { }
}
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress

Write-Host ""
if ($ok) {
  Write-Host "Backend is running.  Database: $($h.database)" -ForegroundColor Green
  if ($Domain) {
    Write-Host "  Public HTTPS : https://$Domain/api/health   (certificate is issued on the first request - allow ~30 s)"
    Write-Host ""
    Write-Host "Next: set js/config.js -> apiBase: 'https://$Domain' in the repo and push; Vercel redeploys." -ForegroundColor Yellow
  } else {
    Write-Host "  On this server : http://localhost:$Port"
    if ($ip) { Write-Host "  On the network : http://${ip}:$Port" }
  }
} else {
  Write-Warning "The backend did not answer on port $Port within 60 s. Last lines of $log :"
  if (Test-Path $log) { Get-Content $log -Tail 25 }
}
$tasks = if ($Domain) { "'DataCareInvoiceAPI' and 'DataCareCaddy'" } else { "'DataCareInvoiceAPI'" }
Write-Host ""
Write-Host ("Manage in Task Scheduler: {0}   |   Log: {1}" -f $tasks, $log)
