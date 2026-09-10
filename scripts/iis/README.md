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
| `../../ecosystem.config.cjs.example` | `C:\telerp\ecosystem.config.cjs` | PM2 process definition with the production environment (gitignored once copied) |
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
  `telerp.telmaco.gr` must be created the same way.
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

```powershell
Copy-Item C:\telerp\ecosystem.config.cjs.example C:\telerp\ecosystem.config.cjs
notepad C:\telerp\ecosystem.config.cjs      # set SOFT1_ERP_PASSWORD to the svc_telerp password
```

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
dump. Then restart the service (it takes about a minute to stop) and confirm both apps
come back on their own with no `pm2` command:

```powershell
Restart-Service pm2.exe
Invoke-WebRequest http://127.0.0.1:3001/api/health -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing | Select-Object StatusCode
```

Finally sign out of the RDP session (not just disconnect), sign back in, and hit both
health URLs again.

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

## Phase 2: Windows authentication (later)

When users and permissions are added, the IIS side changes in these places, all copied from
`C:\fastquote\scripts\iis\fastquote.web.config` and `WindowsUserHeaderModule.cs`:

- Add the `<modules>` block with `IisProxyAuth.WindowsUserHeaderModule` and drop the
  compiled DLL into `C:\apps\telerp\wwwroot\bin`. Requires ASP.NET 4.5 on the server
  (`Web-Asp-Net45`, already installed for FastQuote).
- Add `<location>` blocks that turn Windows auth on and anonymous off for `/api/me` and
  `/api/sso` only. Never at the site root: that makes IIS attach a Negotiate challenge to
  every application 401 and users over VPN get credential prompts on each edit.
- Register the SPN `HTTP/telerp.telmaco.gr` on the computer account `TELAPP1$`
  (`setspn -S HTTP/telerp.telmaco.gr TELAPP1$`), as was done for FastQuote.
- Port FastQuote's session, sso and middleware modules and set `SESSION_SECRET` in
  `ecosystem.config.cjs`. Keep `SESSION_COOKIE_SECURE=false` while the site is HTTP only.

TLS is a separate later step for both apps: a 443 binding with a certificate for
`*.telmaco.gr`, then `SESSION_COOKIE_SECURE=true`.
