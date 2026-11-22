# I-ITSM course project

Employee registrations require administrator approval. New requests are stored as inactive, pending accounts and cannot sign in until an administrator opens **Users → Pending approval → Review registration → Approve account**. Approval is enforced by the backend and persists across restarts. Existing accounts retain their previous status. Only administrators can approve; ordinary account activation cannot bypass pending approval.

Java incident-management services with a browser frontend and persistent SQLite storage, using the supplied `database/store.py` adapter. The updated backend workflows remain in place.

## Run the web application

```powershell
.\start-web.ps1 -Port 8085
```

Open **http://127.0.0.1:8085/**. Requires Java 17 or newer and Python 3 (standard library only). A JDK 21 and bundled Python fallback are configured for this machine. The launcher compiles sources automatically. The port defaults to 8080 if omitted.

If Windows PowerShell blocks the trusted local startup script, launch it for this process only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-web.ps1 -Port 8085
```

Keep that terminal open while using the website, and include `:8085` in the browser address. A connection-refused page means the server is not listening at the requested address; check the terminal for startup errors.

Use employee/emp123, admin/admin123, tech1/tech123, or tech2/tech123. Employee sign-up now creates persistent accounts. Profile/password changes, activation status, technician skills/availability, incidents, original timestamps/deadlines, audit records, notifications, questions and replies survive restarts. Sessions intentionally end when the server stops; sign in again afterward.

The active database is `data/itsm.sqlite`. On the first launch only, the launcher copies the supplied `database/sample.sqlite` there; subsequent launches reuse the existing file. The sample and prior local servers' records are not overwritten. Earlier in-memory demo servers do not automatically migrate into this database. Use the current address above for persistent work.

Optional launcher parameters: `-DatabasePath <path>`, `-PythonPath <python.exe>`, and `-InMemory` for disposable tests. Without `-InMemory`, persistence is enabled by default. To start with an empty database rather than the sample, run Java directly with `--database` pointing to a new file and `--python` pointing to Python; the server creates the schema and four demo accounts.

Stop the server before backing up `data/itsm.sqlite`, and keep the backup outside the running database path. Preserve `data` when copying the project to retain your records. Run one app server per database file. A revision check rejects stale concurrent writes rather than overwriting newer data.

The original console entry point `itsm.Main` remains available as a separate in-memory program. The persistent frontend uses `itsm.web.WebServer` through the launcher.

## Verification

The current upload passes 838 automated assertions across the API, domain services, frontend views, storage integration and legacy database compatibility suites. The database suite uses a temporary copy of the supplied sample and checks registration, legacy-password compatibility, repeated restarts, complete question/reply exchanges, preserved timestamps/deadlines, profile/password changes, workload, activation, transaction rollback, foreign keys and stale-writer conflicts. The real local app also retained a browser-created test ticket across a server restart.

After compiling, run `python tests/storage_integration_test.py --java <path-to-java.exe>` for the 102 database checks and `python tests/web_api_test.py --java <path-to-java.exe>` for 489 API checks. The clean distributable sample contains no incidents; the database suite creates historical fixtures only inside its disposable copy. Frontend/service test commands and remaining domain-policy limitations are documented below.

See [frontend/README.md](frontend/README.md) for the incident workflows, API, existing backend limitations, and verification commands.

### Shared-outage alerts and technician recommendations

Sign in as an administrator and open Overview. A category appears under Shared-outage alerts when at least five tickets arrive within the last 30 minutes and their count is at least three times the average for the same half-hour on the preceding seven days. Days without reports count as zero. Each alert shows the recent ticket links and a suggested investigator. Use Confirm shared outage after reviewing the reports. Confirmation is recorded in the anchor ticket's history. Refresh Overview to update the counts. A quiet half-hour between reports starts a new episode.

Open an unassigned, classified or escalated incident to see the recommended technician and explanation. Available specialists rank first, ordered by unresolved assignments, with technician ID breaking ties. If no specialist is available, the least-loaded available technician is suggested. Selecting Use recommended technician and clicking Assign technician applies the recommendation. The server checks that the displayed choice is still current.
