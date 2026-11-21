# I-ITSM course project

Java incident-management services with a browser frontend and persistent SQLite storage, using the supplied `database/store.py` adapter. The updated backend workflows remain in place.

## Run the web application

```powershell
.\start-web.ps1 -Port 8085
```

Open **http://127.0.0.1:8085/**. Requires Java 17 or newer and Python 3 (standard library only). A JDK 21 and bundled Python fallback are configured for this machine. The launcher compiles sources automatically. The port defaults to 8080 if omitted.

Use employee/emp123, admin/admin123, tech1/tech123, or tech2/tech123. Employee sign-up now creates persistent accounts. Profile/password changes, activation status, technician skills/availability, incidents, original timestamps/deadlines, audit records, notifications, questions and replies survive restarts. Sessions intentionally end when the server stops; sign in again afterward.

The active database is `data/itsm.sqlite`. On the first launch only, the launcher copies the supplied `database/sample.sqlite` there; subsequent launches reuse the existing file. The sample and prior local servers' records are not overwritten. Earlier in-memory demo servers do not automatically migrate into this database. Use the current address above for persistent work.

Optional launcher parameters: `-DatabasePath <path>`, `-PythonPath <python.exe>`, and `-InMemory` for disposable tests. Without `-InMemory`, persistence is enabled by default. To start with an empty database rather than the sample, run Java directly with `--database` pointing to a new file and `--python` pointing to Python; the server creates the schema and four demo accounts.

Stop the server before backing up `data/itsm.sqlite`, and keep the backup outside the running database path. Preserve `data` when copying the project to retain your records. Run one app server per database file. A revision check rejects stale concurrent writes rather than overwriting newer data.

The original console entry point `itsm.Main` remains available as a separate in-memory program. The persistent frontend uses `itsm.web.WebServer` through the launcher.

## Verification

728 assertions passed across the existing API/domain/frontend suites and new database tests. The database suite uses a temporary copy of the supplied sample and checks registration, legacy-password compatibility, repeated restarts, complete question/reply exchanges, preserved timestamps/deadlines, profile/password changes, workload, activation, transaction rollback, foreign keys and stale-writer conflicts. The real local app also retained a browser-created test ticket across a server restart.

After compiling, run `python tests/storage_integration_test.py --java <path-to-java.exe>` for the 83 database checks and `python tests/web_api_test.py --java <path-to-java.exe>` for 442 API checks. Frontend/service test commands and remaining domain-policy limitations are documented below.

See [frontend/README.md](frontend/README.md) for the incident workflows, API, existing backend limitations, and verification commands.
