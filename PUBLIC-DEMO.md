# Temporary public demonstration

The frontend, Java API and Python/SQLite adapter stay on this computer. Cloudflare Quick Tunnel provides a temporary public HTTPS URL. This is a demonstration setup, not independent cloud hosting: the computer, internet connection, Java process and tunnel must stay running. No Cloudflare account or payment card is needed.

Official guide: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

## Current demo data

The separate database `.build/public-demo/itsm.sqlite` contains 80 synthetic incidents from `database/seed_test_data.py`. The original `data/itsm.sqlite` and existing simulation database were not copied into the public demo or changed. Demo profile pictures were removed. Changes made by visitors persist in the separate demo file.

Use only fictional information in this public demo. Employee and technician demonstration credentials are shown on sign-in. Public registration now requires administrator approval. The public demo administrator has a private password saved locally in `.build/public-demo/admin-access.txt`; do not upload or share that file. The old default administrator password no longer works on this demo. Local non-public databases keep their existing credentials.

To approve a request, sign in as the administrator, open Users, select the Pending approval filter, click Review registration, check the applicant's details and click Approve account. New requests also generate an administrator inbox notification. A synthetic request named Approval Demo Employee is available for trying the review screen.

## Start again after stopping

Run these commands from the project folder. The official Cloudflare executable downloaded for this machine is `.build/tools/cloudflared.exe`; it is ignored by Git.

1. In the first PowerShell terminal, start the tunnel:

   ```powershell
   .\.build\tools\cloudflared.exe tunnel --url http://127.0.0.1:8087 --no-autoupdate
   ```

2. Copy the new `https://...trycloudflare.com` origin printed in that terminal. In a second PowerShell terminal, substitute it below (without a trailing slash):

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-web.ps1 -Port 8087 -DatabasePath .build/public-demo/itsm.sqlite -PublicOrigin https://YOUR-NEW-HOST.trycloudflare.com
   ```

3. Share `https://YOUR-NEW-HOST.trycloudflare.com/landing.html`. The page links to sign-in. The complete application is available through the same origin.

4. Keep both terminals open. Press Ctrl+C in both to stop. A new tunnel normally receives a different hostname; restart the Java demo server with that new origin. Do not point multiple app servers at the same database.

The Java listener remains bound to loopback. Public mode accepts only the explicit HTTPS hostname, checks browser write-request origins, and adds `Secure` to its existing HttpOnly/SameSite session cookies. Local startup without `-PublicOrigin` behaves as before. No router port forwarding is needed.

## Verification

After compiling, run:

```powershell
python tests/web_api_test.py --java java
python tests/public_origin_test.py --java java
```

The first suite checks existing workflows. The second checks allowed and rejected hosts, rejected foreign/HTTP origins, and secure session cookies on an isolated test server.

Cloudflare documents Quick Tunnels as testing/development tools without an uptime guarantee. The URL ceases to work when the tunnel stops; database records remain on this computer.
