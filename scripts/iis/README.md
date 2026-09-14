# Hosting TELERP on TelApp1

TELERP is hosted exactly like FastQuote: a Next.js production build run by PM2 on a
loopback port, with an IIS site in front that reverse-proxies to it. Everything below was
lifted from the FastQuote setup that is live on the same server, with the names changed.

This file lives in `scripts/iis/` rather than `docs/` because `docs/` is gitignored.

**Phase 1 (this document): anonymous access for anyone on the intranet.** Windows
authentication and per-user sessions come later; the pieces that change then are listed at
the end.

## Topology

| | FastQuote (live) | TELERP (new) |
| --- | --- | --- |
| Git checkout and PM2 working directory | `C:\fastquote` | `C:\telerp` |
| IIS site physical path (web.config, maintenance.html) | `C:\apps\fastquote\wwwroot` | `C:\apps\telerp\wwwroot` |
| IIS site name and application pool | `fastquote` | `telerp` |
| Node listens on | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Host name | `fastquote.telmaco.gr` | `telerp.telmaco.gr` |
| IIS binding | `192.168.100.84:80:fastquote.telmaco.gr` | `192.168.100.84:80:telerp.telmaco.gr` |
| Authentication at IIS | Windows auth on `/api/me` and `/api/sso` only | Anonymous everywhere |
| Process manager | `pm2.exe` Windows service (pm2-installer) | The same service, as a second app |
| PM2 home | `C:\ProgramData\pm2\home` | Same |
| SQL login | `svc_fastquote` | `svc_telerp`, SELECT on `dbo` and `tlm` only |
| Deploy | `C:\fastquote\scripts\iis\deploy.ps1` | `C:\telerp\scripts\iis\deploy.ps1` |

Both apps share one IIS on port 80 because the bindings differ by host header, and one PM2
daemon because the service hosts every app in its dump file. Nothing on the LAN can reach
Node directly: both ports are bound to loopback.

## Files in this folder

| File | Goes to | Purpose |
| --- | --- | --- |
| `telerp.web.config` | `C:\apps\telerp\wwwroot\web.config` | Reverse proxy to 3001, maintenance gate, error pass-through, anonymous auth |
| `maintenance.html` | `C:\apps\telerp\wwwroot\maintenance.html` | Shown while `maintenance.flag` exists in the site root |
| `deploy.ps1` | Stays in the checkout | Pull, build, restart under the maintenance gate, roll back on failure |
| `deploy.bat` | Stays in the checkout | Elevates and runs `deploy.ps1` |
| `restart.ps1` | Stays in the checkout | Quick restart: re-reads `ecosystem.config.cjs`, no pull, no build |
| `restart.bat` | Stays in the checkout | Elevates and runs `restart.ps1` |
| `ecosystem.config.cjs` (never in git; master copy on the developer PC) | `C:\telerp\ecosystem.config.cjs` | PM2 process definition with the production environment |
| `../sql/2026-09-09-svc_telerp-login.sql` | Run by a DBA on TELDB2 | Creates the read-only SQL login |

## Already on TelApp1 because FastQuote runs there

Check, do not reinstall:

- Node 22.22.0 and npm 10.9.4 (`node -v`, `npm -v`). The same versions the repo is developed on.
- Git with credentials for `github.com/dimitriskyriazis` in Windows Credential Manager.
- IIS with URL Rewrite 2.1 and Application Request Routing 3, proxy enabled at server level.
- The `pm2.exe` Windows service from jessety/pm2-installer, machine-wide `PM2_HOME=C:\ProgramData\pm2\home`, running as `TELMACO\dim.kyriazis` (FastQuote needs that identity for UNC paths; TELERP does not care).
- Outbound TCP 1433 from TelApp1 to TELDB2.
- ODBC Driver 18 and `sqlcmd` (pass `-C` or it rejects the server certificate).

## Step-by-step

Every PowerShell block below is meant for an **elevated** PowerShell on TelApp1 unless it
says otherwise. Open a fresh elevated window after any change to machine environment
variables.

### 1. Make the repo deployable (your PC)

```powershell
npm test          # lint + typecheck
npm run build     # the production build must pass locally first
git add -A; git commit -m "..."; git push
```

`deploy.ps1` pulls `origin/main`, so whatever is on `main` is what goes live.

### 2. SQL login on TELDB2 (DBA)

Hand `scripts/sql/2026-09-09-svc_telerp-login.sql` to whoever has sysadmin on TELDB2.
They set a real password and run it. The `tlm` schema must exist first (the RMT view
script assumes it does). TELERP never runs DDL or DCL itself.

Then verify from TelApp1:

```powershell
sqlcmd -S teldb2 -d SOFT1_ERP -U svc_telerp -P "<password>" -C -Q "SELECT TOP 1 PRJLINES FROM dbo.PRJLINES WHERE SOPLTYPE = 11"
```

### 3. DNS

Facts verified 2026-09-09 from a domain PC:

- `telmaco.gr` is an Active Directory integrated zone (DomainDnsZones partition). Primary
  server `teldc1.telmaco.gr` (192.168.100.18); it replicates to `teldc2` and `achilles`.
- `fastquote.telmaco.gr` is a plain A record, TTL 1 hour, pointing at 192.168.100.84.
  `telerp.telmaco.gr` was created the same way on 2026-09-14 and resolves LAN-wide.
- Writing to the zone needs membership of **Domain Admins** or **DnsAdmins**. Ordinary user
  accounts (including `dim.kyriazis`) cannot do it. TelDC1 accepts remote PowerShell
  (WinRM) and RDP, so nothing has to be installed on the PC that runs the command.

**Create the record** (whoever holds the rights runs this from any domain PC, entering their
admin credentials when prompted):

```powershell
Invoke-Command -ComputerName teldc1.telmaco.gr -Credential (Get-Credential) -ScriptBlock {
  Add-DnsServerResourceRecordA -ZoneName 'telmaco.gr' -Name 'telerp' `
      -IPv4Address '192.168.100.84' -TimeToLive 01:00:00
  Get-DnsServerResourceRecord -ZoneName 'telmaco.gr' -Name 'telerp'
}
```

GUI alternative: RDP to TelDC1, open DNS Manager, Forward Lookup Zones, `telmaco.gr`,
right-click, New Host (A or AAAA), name `telerp`, IP `192.168.100.84`, leave PTR unticked.

**Verify** (any PC):

```powershell
Resolve-DnsName telerp.telmaco.gr -Server teldc1.telmaco.gr   # authoritative, immediate
ipconfig /flushdns
Resolve-DnsName telerp.telmaco.gr                             # through the PC's own servers
```

Replication to teldc2 and achilles follows within minutes; a PC whose first DNS server is
achilles may lag until then.

**Until the record exists** you can test from your own PC (elevated PowerShell) with a hosts
entry, and remove it once DNS is live so it cannot mask a future DNS problem:

```powershell
Add-Content C:\Windows\System32\drivers\etc\hosts "192.168.100.84 telerp.telmaco.gr"
ipconfig /flushdns
```

### 4. Check the PM2 service before touching it

```powershell
Get-Service pm2.exe                                            # Status must be Running
[Environment]::GetEnvironmentVariable('PM2_HOME','Machine')    # C:\ProgramData\pm2\home
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, SessionId, CommandLine
```

All `node.exe` processes must have `SessionId 0` and none may be a `Daemon.js`. If either
is wrong, fix it first (see "Stray PM2 daemon" below). Never run `pm2 list` while the
service is stopped: that alone spawns a stray daemon.

If pm2-installer were ever missing, the recipe FastQuote used was:
`git clone https://github.com/jessety/pm2-installer`, then `npm run configure`,
`npm run configure-policy`, `npm run setup`, then set the service Log On account in
`services.msc` (the GUI grants "Log on as a service"; `sc.exe config` does not).

### 5. Clone and install

```powershell
git clone https://github.com/dimitriskyriazis/telerp.git C:\telerp
Set-Location C:\telerp
npm ci
```

### 6. Production configuration (two gitignored files)

`ecosystem.config.cjs` is deliberately absent from GitHub: `.gitignore` matches
`ecosystem.config.cjs*`, so a fresh clone has neither it nor an example. The master copy
lives in the telerp folder on the developer PC. Copy it to `C:\telerp\ecosystem.config.cjs`
on the server by hand (RDP clipboard or a file share), then check it defines one app named
`telerp` started with `-H 127.0.0.1 -p 3001` and that `SOFT1_ERP_PASSWORD` is the
`svc_telerp` password from step 2.

Then create `C:\telerp\.env.production.local` with one line:

```
NEXT_PUBLIC_AG_GRID_LICENSE=<the same key FastQuote uses>
```

Why two files: `NEXT_PUBLIC_*` values are compiled into the client bundle by `next build`,
so they must be on disk at build time. PM2's `env` block only exists at runtime, which is
fine for the SQL credentials and nothing else. Both files match the `.env*` and
`ecosystem.config.cjs` rules in `.gitignore`.

### 7. IIS site

```powershell
Import-Module WebAdministration
New-Item -ItemType Directory 'C:\apps\telerp\wwwroot' -Force
Copy-Item C:\telerp\scripts\iis\telerp.web.config C:\apps\telerp\wwwroot\web.config
Copy-Item C:\telerp\scripts\iis\maintenance.html  C:\apps\telerp\wwwroot\maintenance.html
New-WebAppPool -Name telerp
New-Website -Name telerp -PhysicalPath 'C:\apps\telerp\wwwroot' -ApplicationPool telerp `
            -IPAddress 192.168.100.84 -Port 80 -HostHeader telerp.telmaco.gr
```

Leave the pool at its defaults (`ApplicationPoolIdentity`, .NET CLR v4.0). TELERP reads
no UNC paths, so no custom identity is needed, and keeping v4.0 means the Windows-auth
module can be added later without a pool change.

Two server-level settings the web.config depends on. FastQuote already needed both, so they
should be present; verify rather than assume:

```powershell
# ARR proxy must be enabled
Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled

# every HTTP_* name the proxy rule sets must be allowed, or IIS answers 500.50
Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/rewrite/allowedServerVariables/add' | Select-Object name
```

Add a missing variable with:

```powershell
& "$env:windir\system32\inetsrv\appcmd.exe" set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_HOST']" /commit:apphost
```

The names used: `HTTP_X_WINDOWS_USER`, `HTTP_X_USER_ID`, `HTTP_X_FORWARDED_PROTO`,
`HTTP_X_FORWARDED_HOST`, `HTTP_X_FORWARDED_FOR`.

### 8. First build and start

Do the first one by hand so every step is visible. `deploy.ps1` is for the second deploy
onwards (it also works for the first, but it hides the steps behind the maintenance gate).

```powershell
$env:PM2_HOME = 'C:\ProgramData\pm2\home'
Set-Location C:\telerp
npm run build
pm2 start C:\telerp\ecosystem.config.cjs
pm2 save
Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing | Select-Object StatusCode, Content
```

Expected: status 200 and a body starting `{"ok":true,"status":"healthy","database":"connected"`.
A 503 with `"database":"error"` means Node is fine and SQL is not: check the password in
`ecosystem.config.cjs` and the login from step 2.

Now through IIS (add the hosts entry from step 3 on the server if DNS is not there yet):

```powershell
Invoke-WebRequest http://telerp.telmaco.gr/api/health -UseBasicParsing | Select-Object StatusCode
```

Then open `http://telerp.telmaco.gr/` in a browser on any PC on the LAN.

### 9. Prove it survives sign-out and reboot

This is the check FastQuote skipped and paid for twice.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, SessionId, CommandLine
Get-NetTCPConnection -LocalPort 3001 -State Listen | Select-Object OwningProcess
Select-String -Path C:\ProgramData\pm2\home\dump.pm2 -Pattern telerp -SimpleMatch | Measure-Object
```

All node processes in session 0, the owner of 3001 among them, and at least one hit in the
dump. Then restart the service and confirm both apps come back on their own with no `pm2`
command. **This restarts FastQuote too** (both apps live in the one service daemon), so it
is a one-minute FastQuote outage: do it out of office hours or skip it. The sign-out test
below is safe at any time and proves the same thing for TELERP.

```powershell
Restart-Service pm2.exe
Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing | Select-Object StatusCode
```

Finally sign out of the RDP session (not just disconnect), sign back in, and hit both
health URLs again.

### What never touches FastQuote

Every command in steps 5 to 8 and 10 is scoped to TELERP: `pm2 start` with the telerp
ecosystem file only starts the apps in that file, `pm2 save` writes both apps to the dump
without restarting either, `New-Website` and `Restart-WebAppPool -Name telerp` act on the
telerp site alone. The commands that WOULD interrupt FastQuote are `Restart-Service pm2.exe`,
`pm2 kill`, `pm2 restart all`, `pm2 delete fastquote`, `iisreset` and
`Restart-WebAppPool -Name fastquote`. None of them is needed to bring TELERP up.

### 10. Routine deploys

Push to `main`, then on TelApp1 double-click `C:\telerp\scripts\iis\deploy.bat`. It
elevates and runs `deploy.ps1`, which:

1. Creates `maintenance.flag` so IIS serves `maintenance.html` to everyone.
2. Pulls `main`.
3. Stops the `telerp` PM2 app and renames `.next` to `.next.prev`.
4. Runs `npm ci` only when `package-lock.json` changed, then `npm run build`.
5. Starts PM2, saves the dump, removes the flag, recycles the `telerp` pool.
6. Deletes `.next.prev`.

Any failure after step 3 restores `.next.prev`, resets to the previous commit and brings
the previous build back up, so a bad deploy ends with the old version live rather than an
outage. The script refuses to start if the PM2 service is stopped or a stray daemon exists.

Because the script pulls itself, a change to `deploy.ps1` takes effect on the deploy after
the one that pulled it. Users may need a hard refresh (Ctrl+Shift+R) after a deploy to drop
the cached client bundle.

### 11. Quick restart without a deploy

Double-click `C:\telerp\scripts\iis\restart.bat` after editing `ecosystem.config.cjs`
(new SQL password, changed setting) or when the app is wedged. It elevates and runs
`restart.ps1`, which checks the PM2 service, does `pm2 delete telerp` and `pm2 start` with
the ecosystem file (the only way PM2 re-reads the env block; `pm2 restart` keeps the old
values), saves the dump, waits for port 3001, confirms the process is in session 0 and
prints the health probe with its body. Downtime is the few seconds Node takes to boot.
FastQuote is never touched.

## Troubleshooting

**502 from IIS.** Node is not listening on 3001. `Get-NetTCPConnection -LocalPort 3001`
then `Get-Service pm2.exe`. If the service is down after a reboot or restart with error
1069, the service account password changed: fix it in `services.msc`, Log On tab.

**500.50.** A server variable set in web.config is not in the allowed list (step 7).

**500.19.** A section in web.config is locked at server level. FastQuote unlocked the
authentication sections already; if it recurs:
`appcmd unlock config -section:system.webServer/security/authentication/anonymousAuthentication`
and the same for `windowsAuthentication`.

**Stuck on the maintenance page after a deploy.** IIS caches the maintenance response.
`Restart-WebAppPool -Name telerp` after making sure `C:\apps\telerp\wwwroot\maintenance.flag`
is gone.

**Stray PM2 daemon.** Symptom: the site dies when someone signs out of the server, or
`pm2` commands from a non-elevated window fail with `connect EPERM //./pipe/rpc.sock`.
Cause: a `pm2` command ran where it could not reach the service daemon, so PM2 started a
private daemon in that user's session, and the next `pm2 start` put the app under it.
Recovery, in an elevated window:

```powershell
$env:PM2_HOME = 'C:\ProgramData\pm2\home'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, SessionId, CommandLine
# Stop-Process the Daemon.js first, then any app process outside session 0
Restart-Service pm2.exe       # the service resurrects both apps from dump.pm2
```

Never `pm2 kill`: it kills the daemon inside the service. Never `pm2 delete fastquote`
while working on TELERP; `pm2 delete telerp` is the only delete the TELERP deploy makes.

**Build cache growth.** `next.config.ts` turns the persistent Turbopack build cache off.
FastQuote's `.next` reached about 5 GB before that was discovered, and `deploy.ps1`
discards `.next` on every deploy anyway.

## Phase 2: Windows authentication

Same mechanism as FastQuote, with the user list in `tlm.Users` on SOFT1_ERP instead of
FastQuote's own database:

1. IIS keeps the site anonymous except `/api/me` and `/api/sso`, where Windows
   authentication is required. The managed module `IisProxyAuth.WindowsUserHeaderModule`
   stamps the authenticated account into `X-Windows-User` after the handshake; the rewrite
   rule destroys any client-supplied copy first, and Node listens on loopback only.
2. `POST /api/me` maps that identity to a row of `tlm.Users` by `DomainName`
   (`TELMACO\sAMAccountName`) and mints an HMAC-signed, httpOnly session cookie plus a
   JS-readable expiry hint. No row means "Access denied".
3. `proxy.ts` verifies the cookie on every request, rejects API calls without one (401
   JSON) and slides a still-valid session forward, capped at the absolute TTL from the
   original login. The Windows handshake therefore happens once per login, not on a timer.
4. `AuthProvider` on the client establishes the session before anything renders and shows
   "Access denied" or "Sign-in unavailable" instead of a broken app.

Access is a row in `tlm.Users`. Add or remove rows by hand on TELDB2 (a removed user is
signed out at their next page load). Definition and seed: `scripts/sql/2026-09-14-tlm-Users.sql`.

### A. Admin hand-offs (Domain Admins; independent of B and C)

Both are needed for a prompt-free experience. Without them the site still works: browsers
fall back to NTLM and, where a site is not trusted, show one credential prompt.

**SPN for Kerberos.** The telerp pool runs as ApplicationPoolIdentity, so the SPN goes on
the computer account, exactly as for FastQuote:

```powershell
setspn -S HTTP/telerp.telmaco.gr TELAPP1$
setspn -L TELAPP1$          # should now list HTTP/fastquote.telmaco.gr and HTTP/telerp.telmaco.gr
```

**Group Policy: edit the GPO `FastQuote-SSO`.** Browsers send Windows credentials
automatically only to sites they are told to trust. The one policy that does this is
`FastQuote-SSO` (GUID `{9D7BBC77-71C0-4624-BBD3-0651060CFD48}`, linked at
`OU=TELMACO,DC=telmaco,DC=gr`, last changed 2026-02-03; read from SYSVOL 2026-09-14) and
it names FastQuote alone. In Group Policy Management on TelDC1, open it and under
**Computer Configuration** add TelERP beside FastQuote in these six places:

| Where | Setting | Today | Change to |
| --- | --- | --- | --- |
| Preferences > Windows Settings > Registry | Item `http` under `HKLM\Software\Policies\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Domains\telmaco.gr\fastquote` (REG_DWORD 1, action Update) | fastquote only | Add a second item: same hive, key `...\ZoneMap\Domains\telmaco.gr\telerp`, value name `http`, REG_DWORD, data `1`, action Update |
| Policies > Administrative Templates > Google > Google Chrome > HTTP authentication | Authentication server allowlist | `fastquote.telmaco.gr` | `fastquote.telmaco.gr,telerp.telmaco.gr` |
| same | Kerberos delegation server allowlist | `fastquote.telmaco.gr` | `fastquote.telmaco.gr,telerp.telmaco.gr` |
| same | Allow all HTTP authentication schemes for these origins (list) | `http://fastquote.telmaco.gr` | add entry `http://telerp.telmaco.gr` |
| Policies > Administrative Templates > Microsoft Edge > HTTP authentication | Configure list of allowed authentication servers | `http://fastquote.telmaco.gr` | `http://fastquote.telmaco.gr,http://telerp.telmaco.gr` |
| same | Allow all HTTP authentication schemes for these origins (list) | `http://fastquote.telmaco.gr` | add entry `http://telerp.telmaco.gr` |

The second Preferences item in that GPO (`Zones\1`, value `1A00` = 0, "log on
automatically in the Intranet zone") already covers every Intranet site and needs no change.
Wildcard alternative: `*.telmaco.gr` in the four Chrome/Edge settings, and a Preferences item
on key `...\ZoneMap\Domains\telmaco.gr` (no host subkey) with `http` = 1, which puts every
host under telmaco.gr in the Intranet zone.

The same six changes from an elevated PowerShell on TelDC1 (GroupPolicy module), which
writes them straight into the GPO. The Intranet-zone entry is written as a policy registry
value here rather than a Preferences item; on the client it lands in the identical key and
behaves the same. Value name `2` continues the numbered lists that already hold entry `1`:

```powershell
Import-Module GroupPolicy
$gpo = 'FastQuote-SSO'
Set-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Domains\telmaco.gr\telerp' -ValueName 'http' -Type DWord -Value 1
Set-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Google\Chrome' -ValueName 'AuthServerAllowlist' -Type String -Value 'fastquote.telmaco.gr,telerp.telmaco.gr'
Set-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Google\Chrome' -ValueName 'AuthNegotiateDelegateAllowlist' -Type String -Value 'fastquote.telmaco.gr,telerp.telmaco.gr'
Set-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Google\Chrome\AllHttpAuthSchemesAllowedForOrigins' -ValueName '2' -Type String -Value 'http://telerp.telmaco.gr'
Set-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Microsoft\Edge' -ValueName 'AuthServerAllowlist' -Type String -Value 'http://fastquote.telmaco.gr,http://telerp.telmaco.gr'
Set-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Microsoft\Edge\AllHttpAuthSchemesAllowedForOrigins' -ValueName '2' -Type String -Value 'http://telerp.telmaco.gr'
Get-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Google\Chrome' | Format-Table ValueName, Value
Get-GPRegistryValue -Name $gpo -Key 'HKLM\Software\Policies\Microsoft\Edge' | Format-Table ValueName, Value
```

Clients pick the change up at their next policy refresh (about 90 minutes) or immediately
with `gpupdate /force`. Check on a client:

```powershell
Get-ItemProperty 'HKLM:\Software\Policies\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Domains\telmaco.gr\telerp'
(Get-ItemProperty HKLM:\Software\Policies\Google\Chrome).AuthServerAllowlist
(Get-ItemProperty HKLM:\Software\Policies\Microsoft\Edge).AuthServerAllowlist
```

### B. IIS on TelApp1 (elevated)

The header module DLL is the same assembly FastQuote uses; copy it rather than rebuild.
Editing web.config recycles the telerp pool only.

```powershell
New-Item -ItemType Directory 'C:\apps\telerp\wwwroot\bin' -Force
Copy-Item 'C:\apps\fastquote\wwwroot\bin\IisProxyAuth.dll' 'C:\apps\telerp\wwwroot\bin\'
Set-Location C:\telerp; git pull
Copy-Item C:\telerp\scripts\iis\telerp.web.config C:\apps\telerp\wwwroot\web.config
Get-ItemProperty IIS:\AppPools\telerp -Name managedRuntimeVersion, managedPipelineMode   # v4.0 / Integrated
```

Prove the handshake at IIS before the code is deployed. `--negotiate -u :` makes curl use
your Windows logon; the app has no `/api/sso` route yet, so a 404 after the challenge is
the pass mark (a 401 with `WWW-Authenticate: Negotiate` first, then Node's answer):

```powershell
curl.exe -s -i --negotiate -u : http://telerp.telmaco.gr/api/sso
```

500.19 means a locked configuration section (Troubleshooting below). A 500 mentioning the
module means ASP.NET is missing from the pool or the DLL is not in `bin\`.

### C. Server environment

Add these keys to the `env` block of `C:\telerp\ecosystem.config.cjs` on the server. The
developer PC's copy already has them, but do not overwrite the server file wholesale
without checking `SOFT1_ERP_USER` and `SOFT1_ERP_PASSWORD` first: the two copies have
diverged on the SQL login before.

| Variable | Value |
| --- | --- |
| `SESSION_SECRET` | Long random string. Different from FastQuote's and from the dev value. |
| `AUTH_REQUIRE_SESSION` | `'true'`. API calls without a session get 401. (`'false'` reopens the site anonymously.) |
| `SESSION_COOKIE_SECURE` | `'false'` while the site is HTTP only. |
| `SESSION_TTL_SECONDS`, `SESSION_RENEW_WINDOW_SECONDS`, `SESSION_ABSOLUTE_TTL_SECONDS` | Optional; defaults 8 h, 4 h, 12 h. |

### D. Deploy and verify

Run `deploy.bat`. Then, from a domain PC:

- `http://telerp.telmaco.gr/api/sso` in the browser shows your `tlm.Users` row as JSON.
- The site shows your Username at the foot of the nav.
- A colleague without a `tlm.Users` row sees "Access denied" with their identity.
- `curl.exe -s -i http://telerp.telmaco.gr/api/rmt/tasks -X POST` (no cookie) answers 401.

### Rollback

Set `AUTH_REQUIRE_SESSION: 'false'` in `ecosystem.config.cjs` and run `restart.bat`. The
API gate opens and the app renders for everyone with "Not signed in" in the nav. The IIS
pieces can stay in place.

### Differences from FastQuote, for the record

- Pages are not rejected by the proxy; only API calls are. A deep link renders the shell
  and the client provider signs the user in (or shows Access denied). FastQuote answers a
  bare 401 page on deep links.
- Rate limiting, request ids and the audit-user cookie were not ported.
- Development: `DEV_AUTO_WINDOWS_USER` in `.env.local` stands in for IIS and is resolved
  through `tlm.Users` on the dev snapshot, so the table must exist there (run the script).

TLS is a separate later step for both apps: a 443 binding with a certificate for
`*.telmaco.gr`, then `SESSION_COOKIE_SECURE=true`.
