#Requires -RunAsAdministrator
<#
  TELERP production deploy on TelApp1. Adapted from C:\fastquote\scripts\iis\deploy.ps1.
  Run via deploy.bat (which elevates and calls this with -File).

  Flow: maintenance gate ON (flag + pool recycle, then PROVE the page is served) -> pull
  -> stop Node -> set the previous build aside -> install + build -> start Node -> wait
  until it listens -> gate OFF. While the gate file exists, the IIS "Maintenance Mode"
  rewrite rule serves maintenance.html for every request, so users never hit the
  half-deployed / stopped backend.

  GATE GOTCHA (2026-09-14): IIS kept answering from its caches after the flag file appeared,
  so on TelERP's 20-second deploys the flag alone did nothing and users got 502s the whole
  time Node was down (IIS log W3SVC3: 502.3, win32 status 12029). The mirror problem was
  already known: deleting the flag alone leaves the site stuck on the page. Both directions
  get the same cure, a recycle of the telerp pool right after touching the flag, and the gate
  is verified with a real request before Node is stopped.

  ROLLBACK: next build overwrites .next in place. We rename .next to .next.prev before
  building and restore it (plus the previous commit and its node_modules) if anything
  fails, so a failed deploy ends with the site LIVE on the previous build rather than down.

  PM2: the daemon is hosted IN-PROCESS by the pm2-installer Windows service (pm2.exe),
  shared with FastQuote. Every pm2 call here must reach THAT daemon, so PM2_HOME is pinned
  to the machine value first. A console with a different PM2_HOME, or a pm2 command run
  while the service is stopped, spawns a stray session-local daemon; the app then dies
  when the operator signs out (FastQuote outages 2026-07-31 and 2026-09-04).

  This script runs git pull on itself, so a change to it takes effect on the NEXT deploy.
#>

# --- Paths -------------------------------------------------------------------
$AppRoot   = 'C:\telerp'                 # Node app + git repo (PM2 runs from here)
$SiteRoot  = 'C:\apps\telerp\wwwroot'    # IIS site physical path (web.config + maintenance.html)
$AppPool   = 'telerp'                    # IIS application pool name
$Pm2Name   = 'telerp'                    # "name" in ecosystem.config.cjs
$Port      = 3001                        # -p in ecosystem.config.cjs (3000 is FastQuote)
$Flag      = Join-Path $SiteRoot 'maintenance.flag'
$Dist      = Join-Path $AppRoot '.next'
$DistPrev  = Join-Path $AppRoot '.next.prev'
$Ecosystem = Join-Path $AppRoot 'ecosystem.config.cjs'
$SiteUrl   = 'http://telerp.telmaco.gr'  # IIS binding (host header); resolves to this server
$MaintSrc  = Join-Path $AppRoot  'scripts\iis\maintenance.html'   # tracked page
$MaintLive = Join-Path $SiteRoot 'maintenance.html'               # the page IIS serves
$WebCfgSrc  = Join-Path $AppRoot  'scripts\iis\telerp.web.config'
$WebCfgLive = Join-Path $SiteRoot 'web.config'

# Machine-wide PM2 home used by the pm2.exe service. Never let a user-level value win.
$env:PM2_HOME = 'C:\ProgramData\pm2\home'

Import-Module WebAdministration -ErrorAction SilentlyContinue

# Commit the site is running right now. Captured before git pull so it is a real
# rollback target; printed on every failure path so recovery never needs archaeology.
$PreSha = ''

function Get-Pm2Problem {
  $svc = Get-Service -Name 'pm2.exe' -ErrorAction SilentlyContinue
  if (-not $svc) {
    return 'PM2 Windows service (pm2.exe) not found. Install pm2-installer first (scripts/iis/README.md, step 4).'
  }
  if ($svc.Status -ne 'Running') {
    return "PM2 service is $($svc.Status). Run Start-Service pm2.exe and retry. Do NOT run pm2 commands while it is stopped."
  }
  $stray = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
           Where-Object { $_.CommandLine -match 'Daemon\.js' }
  if ($stray) {
    $pids = ($stray | ForEach-Object { $_.ProcessId }) -join ', '
    return "Stray PM2 daemon outside the service (node.exe PID $pids). Stop-Process it, then Restart-Service pm2.exe, then retry."
  }
  return $null
}

function Test-NodeInSessionZero {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  return ($null -ne $proc -and $proc.SessionId -eq 0)
}

# Keep the page IIS serves identical to the tracked one. web.config is deliberately NOT synced
# here: a bad web.config takes the site down, and only a human should push that button.
function Sync-MaintenancePage {
  if (-not (Test-Path $MaintSrc)) { return }
  if ((Test-Path $MaintLive) -and ((Get-FileHash $MaintSrc).Hash -eq (Get-FileHash $MaintLive).Hash)) { return }
  Copy-Item $MaintSrc $MaintLive -Force
  Write-Host "Copied maintenance.html to $SiteRoot" -ForegroundColor DarkGray
}

# True once something listens on $Port. pm2 start returns as soon as the process is spawned;
# next start needs about a second before it accepts connections.
function Wait-ForPort($Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

# True when IIS answers a fresh request with the maintenance page. The <title> of the live page
# is the marker, so a redesign never breaks the check; the random query string defeats any
# cached answer for "/".
function Test-GateEngaged {
  if (-not (Test-Path $MaintLive)) { return $false }
  $title = [regex]::Match((Get-Content $MaintLive -Raw), '<title>([^<]+)</title>').Groups[1].Value
  if (-not $title) { return $false }
  try {
    $probe = "$SiteUrl/?gate=$([guid]::NewGuid().ToString('N'))"
    $r = Invoke-WebRequest -Uri $probe -UseBasicParsing -TimeoutSec 10
    return ($r.StatusCode -eq 200 -and $r.Content.Contains($title))
  } catch {
    return $false
  }
}

function Bring-SiteUp {
  pm2 delete $Pm2Name 2>$null | Out-Null
  pm2 start $Ecosystem
  if ($LASTEXITCODE -ne 0) { return $false }
  pm2 save | Out-Null
  # Lift the gate only once Node accepts connections, or the first refreshes land on a 502.
  if (-not (Wait-ForPort 60)) {
    Write-Host "Node did not start listening on port $Port within 60 s. Check: pm2 logs $Pm2Name --lines 50" -ForegroundColor Red
    return $false
  }
  if (Test-Path $Flag) { Remove-Item $Flag -Force }
  # IIS kernel/output-caches the maintenance.html response, so deleting the flag alone is NOT
  # enough - the site stays stuck on the maintenance page until the app pool is recycled.
  Restart-WebAppPool -Name $AppPool
  return $true
}

# Failure AFTER the previous build was set aside: put everything back and come up on it.
function Fail-WithRollback($msg) {
  Write-Host ''
  Write-Host "DEPLOY FAILED: $msg" -ForegroundColor Red
  Write-Host "Rolling back to $PreSha ..." -ForegroundColor Yellow

  if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $DistPrev) { Rename-Item $DistPrev '.next' -ErrorAction SilentlyContinue }

  git reset --hard $PreSha
  npm ci

  if ((Test-Path $Dist) -and (Bring-SiteUp)) {
    Write-Host ''
    Write-Host "Rolled back. Site is LIVE on the previous build ($PreSha)." -ForegroundColor Green
    Write-Host 'The deploy did NOT apply. Fix the problem and re-run.' -ForegroundColor Yellow
    exit 1
  }

  Write-Host ''
  Write-Host 'ROLLBACK ALSO FAILED - THE SITE IS DOWN AND STILL IN MAINTENANCE MODE.' -ForegroundColor Red
  Write-Host 'Recover by hand, in this order (elevated console):' -ForegroundColor Yellow
  Write-Host '  $env:PM2_HOME = "C:\ProgramData\pm2\home"' -ForegroundColor Yellow
  Write-Host "  cd $AppRoot" -ForegroundColor Yellow
  Write-Host "  git reset --hard $PreSha" -ForegroundColor Yellow
  Write-Host '  npm ci' -ForegroundColor Yellow
  Write-Host '  npm run build' -ForegroundColor Yellow
  Write-Host "  pm2 start $Ecosystem; pm2 save" -ForegroundColor Yellow
  Write-Host "  Remove-Item '$Flag' -Force" -ForegroundColor Yellow
  Write-Host "  Restart-WebAppPool -Name $AppPool   # after the flag is gone, or IIS stays on the page" -ForegroundColor Yellow
  exit 1
}

# Failure BEFORE anything was touched: nothing to undo, site is still serving.
function Fail-Early($msg) {
  Write-Host ''
  Write-Host "DEPLOY ABORTED: $msg" -ForegroundColor Red
  Write-Host 'Nothing was changed - the site is still running the current build.' -ForegroundColor Yellow
  Write-Host 'Taking it out of maintenance mode.' -ForegroundColor Yellow
  if (Test-Path $Flag) { Remove-Item $Flag -Force }
  Restart-WebAppPool -Name $AppPool
  exit 1
}

# --- Sanity checks (before we change anything) -------------------------------
if (-not (Test-Path $SiteRoot)) {
  Write-Host "SiteRoot '$SiteRoot' not found - create the IIS site first (scripts/iis/README.md, step 7)." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $MaintSrc) -and -not (Test-Path $MaintLive)) {
  Write-Host "WARNING: maintenance.html is missing from both the checkout and $SiteRoot - the gate will 404 while it is on." -ForegroundColor Yellow
}
if (-not (Test-Path $Ecosystem)) {
  Write-Host "ecosystem.config.cjs not found at $Ecosystem - copy it from the developer PC (it is never in git)." -ForegroundColor Red
  exit 1
}
$pm2Problem = Get-Pm2Problem
if ($pm2Problem) {
  Write-Host $pm2Problem -ForegroundColor Red
  exit 1
}

Set-Location $AppRoot

# A leftover .next.prev means the last deploy died mid-flight. Refuse to overwrite the
# only surviving copy of a known-good build - the operator must look at it first.
if (Test-Path $DistPrev) {
  Write-Host "'$DistPrev' already exists - a previous deploy did not finish cleanly." -ForegroundColor Red
  Write-Host 'Inspect it, then delete or restore it before deploying again.' -ForegroundColor Yellow
  exit 1
}

$PreSha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $PreSha) {
  Write-Host "Could not read the current commit in $AppRoot - is it a git checkout?" -ForegroundColor Red
  exit 1
}
Write-Host "Current build is at $PreSha" -ForegroundColor Cyan

# --- 1) Maintenance ON --------------------------------------------------------
Sync-MaintenancePage
New-Item -ItemType File $Flag -Force | Out-Null
# IIS does not notice a new flag file by itself (GATE GOTCHA in the header): recycle the pool so
# the next request re-evaluates the rewrite rule, then prove it with a real request. The old
# build is still running, so the recycle costs users nothing but the maintenance page.
Restart-WebAppPool -Name $AppPool
$GateUp = $false
foreach ($attempt in 1..8) {
  if (Test-GateEngaged) { $GateUp = $true; break }
  Start-Sleep -Seconds 2
}
if ($GateUp) {
  Write-Host "Maintenance mode ON  ($Flag) - verified: $SiteUrl serves maintenance.html" -ForegroundColor Cyan
} else {
  Write-Host "Maintenance mode ON  ($Flag)" -ForegroundColor Cyan
  Write-Host "WARNING: $SiteUrl still does not serve maintenance.html. Users will get a 502 while Node is down." -ForegroundColor Yellow
  Write-Host '         Continuing anyway. See scripts/iis/README.md, "Maintenance page never appears".' -ForegroundColor Yellow
}

# --- 2) Pull (still serving the old build; nothing destroyed yet) -------------
git pull
if ($LASTEXITCODE -ne 0) { Fail-Early 'git pull failed (dirty working tree or network).' }
Sync-MaintenancePage   # the pull may have changed the page; IIS serves the new one from here on
if ((Test-Path $WebCfgSrc) -and (Test-Path $WebCfgLive) -and (Compare-Object (Get-Content $WebCfgSrc) (Get-Content $WebCfgLive))) {
  Write-Host "NOTE: $WebCfgLive differs from scripts\iis\telerp.web.config. Review the diff and copy it by hand (README, Phase 2 B)." -ForegroundColor Yellow
}

# --- 3) Stop Node, then set the previous build aside -------------------------
# Node must be stopped first: a running next start holds handles under .next, and
# Windows will not let us rename the directory out from under it.
pm2 stop $Pm2Name 2>$null | Out-Null
if (Test-Path $Dist) {
  Rename-Item $Dist '.next.prev' -ErrorAction SilentlyContinue
  if (Test-Path $Dist) { Fail-WithRollback 'could not set .next aside (file still locked - is another node.exe running?).' }
}

# --- 4) Install + build ------------------------------------------------------
# npm ci, not npm install: the lockfile is authoritative, so prod can never silently
# re-resolve a dependency. Skipped when package-lock.json is identical to the commit that
# is live right now. Any git error makes $LockChanged true, so the safe path is the default.
git diff --quiet $PreSha HEAD -- package-lock.json
$LockChanged = ($LASTEXITCODE -ne 0)
if ($LockChanged -or -not (Test-Path (Join-Path $AppRoot 'node_modules'))) {
  npm ci
  if ($LASTEXITCODE -ne 0) { Fail-WithRollback 'npm ci failed.' }
} else {
  Write-Host 'package-lock.json unchanged since the live commit - keeping node_modules.' -ForegroundColor DarkGray
}

npm run build
if ($LASTEXITCODE -ne 0) { Fail-WithRollback 'next build failed.' }

# --- 5) Start Node + maintenance OFF -----------------------------------------
if (-not (Bring-SiteUp)) { Fail-WithRollback 'Node did not come up (pm2 start failed, or nothing listened on the port within 60 s).' }

# --- 6) Only now is the previous build expendable ----------------------------
Remove-Item $DistPrev -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Deploy complete - maintenance mode OFF, Node is live.' -ForegroundColor Green
Write-Host "  was: $PreSha" -ForegroundColor DarkGray
Write-Host "  now: $((git rev-parse HEAD).Trim())" -ForegroundColor DarkGray

if (-not (Test-NodeInSessionZero)) {
  Write-Host ''
  Write-Host "WARNING: the process on port $Port is not in session 0 (or not listening yet)." -ForegroundColor Yellow
  Write-Host 'If it is in your RDP session it will die when you sign out. See scripts/iis/README.md, "Stray PM2 daemon".' -ForegroundColor Yellow
}
try {
  $Health = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 15
  Write-Host "Health: $($Health.StatusCode) $($Health.Content)" -ForegroundColor Cyan
} catch {
  Write-Host "Health probe failed: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host '  (503 = Node is up but SQL is not: check the credentials in ecosystem.config.cjs)' -ForegroundColor Yellow
}
Write-Host "Smoke-test from a PC: $SiteUrl/api/health should return the same body." -ForegroundColor Cyan
