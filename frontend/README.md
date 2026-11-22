# I-ITSM incident workspace

**Current version:** http://127.0.0.1:8085/ uses persistent SQLite storage and working employee registration. Start with `.\start-web.ps1 -Port 8085`. See [Persistent storage integration](#persistent-storage-integration) for current behavior. Earlier sections below retain the implementation history; statements about temporary storage, pending registration and earlier ports describe previous versions.

The incident UI now uses a same-origin Java HTTP adapter. There is no local mock service or client-side copy of priority, assignment, SLA, or lifecycle rules. Those operations call the existing Java classes.

## Start

From the repository root in PowerShell:

```powershell
.\start-web.ps1
```

Open **http://127.0.0.1:8080** (do not open `index.html` directly). Use `-Port 8081` if needed. Requires Java 17+; the launcher also recognizes the JDK 21 installation on this machine. Stop with Ctrl+C.

The original `itsm.Main` console entry point remains intact. The web server uses its own service instances, so it does not share data with a separately running console process. All storage is in memory, as in the original backend; restarting the Java server resets records. Logging out or reloading the browser does not reset them.

## Existing course-project accounts

| Username | Password | Role |
| --- | --- | --- |
| employee | emp123 | Employee E001 |
| admin | admin123 | Administrator A001 |
| tech1 | tech123 | Network technician T001 |
| tech2 | tech123 | Hardware technician T002 |

The local adapter reuses the console demo accounts and password model. It binds only to 127.0.0.1. Session cookies are scoped by server port, HttpOnly, SameSite=Strict, expire after eight hours, and are invalidated on sign-out. API authorization is checked on the server. This is the local course-project setup, not a production authentication system.

## Verify a complete workflow

1. Sign in as employee. Report a NETWORK incident with title, description, and three 1–5 factors. The priority preview is returned by Java. Submit and open details; check the classification, deadlines, and create history.
2. Sign out from the profile button. Sign in as admin. Open the ID, choose skill-based assignment, and assign. Check the technician and history. Load-based selects the least busy available technician, regardless of skills, matching Java.
3. Sign in as tech1. Acknowledge, start investigation, request employee information. Sign in as employee and add information. This does not resume investigation automatically. As tech1, resume and resolve with nonblank resolution notes.
4. As employee, verify the resolution, then close. These are separate actions. Check closure time, notifications, and history. Technician workload decreases only at closure.
5. Use the five simultaneous exact filters (category, priority, status, reporter ID, technician), plus ID/title search. Highest priority is the default sort. ID and newest-first sorts are also available. Summary counts describe the entire role-visible register, not the filtered rows.
6. Create two similar incidents in the same category to see duplicate suggestions. Duplicate matching uses Java's word-set similarity threshold of 0.5. Only accessible records are disclosed.
7. As admin, use Check SLA breaches to invoke the existing escalation service. It is explicit, matching the console menu; there is no new scheduler. Refresh rechecks SLA states. In details, use Refresh details.

Loading, connection failures, invalid credentials, empty results, no-assignment matches, invalid transitions, and expired sessions have visible states. Requests are not automatically retried, to avoid duplicate writes after a network timeout.

## Backend mappings and limits

- `IncidentService`: create, role-scoped lists, assign, acknowledge, start, wait, resume, resolve, verify, close.
- `PriorityCalculator`: server-calculated score bands (75+, 40+, 15+, below 15).
- `SLAService`: response/resolution deadlines and risk/breach status, unchanged.
- `IntelligentIncidentService`: duplicates and explicit SLA escalation, unchanged.
- `AuditService` and `NotificationService`: incident history, per-user in-app notifications, simulated console notification on resolution.
- Five exact API filters delegate to `ReportService`. The adapter excludes unassigned incidents before a nonblank technician filter to avoid the existing service's null dereference. The UI applies the same five exact criteria to its authorized snapshot for immediate feedback.
- The adapter captures the previous state before assignment, avoiding the console's reference-mutation audit issue.
- Update: administrators can manually reassign an already-assigned escalated incident to another available technician, returning it to ASSIGNED without resetting deadlines. See Manual reassignment below.
- Separate investigation notes, attachments, threaded conversations, feedback, affected services, arbitrary status edits, deletion, user registration/administration, and SLA configuration are not exposed by this incident slice.

## API

Responses are JSON; writes use `application/x-www-form-urlencoded`. Authentication is a same-origin session cookie. Identity and IDs are derived by the server, not accepted from action forms.

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/session` | Username/password login |
| GET | `/api/session` | Current safe user details |
| POST | `/api/logout` | Invalidate session |
| GET | `/api/incidents` | Authorized list, metadata, users, notifications; optional five exact filter query parameters |
| POST | `/api/incidents` | Employee reporting: title, description, category, impact, urgency, businessCriticality |
| GET | `/api/incidents/{id}` | Authorized details, deadlines, actions, history, duplicate suggestions |
| POST | `/api/incidents/{id}/{action}` | assign (strategy SKILL/LOAD), acknowledge, start, request-information, resume, resolve (notes), verify, close, add-information (notes) |
| POST | `/api/priority` | Non-mutating priority calculation from three factors |
| POST | `/api/escalate` | Admin SLA escalation pass; returns changed count |

The server serializes access to the existing mutable services so parallel requests cannot duplicate incident IDs or bypass transitions. Static files and API share an origin; external Origin headers and unrecognized Host headers are rejected. No CORS grant is needed. The transport never substitutes sample data on failure.

## Checks

After compiling via the launcher:

```powershell
python tests/web_api_test.py --java 'C:/Program Files/Java/jdk-21.0.11/bin/java.exe'
javac -encoding UTF-8 -cp .build/classes -d .build/classes tests/ServiceContractTest.java
java -cp .build/classes ServiceContractTest
```

The API suite starts an isolated server on a random loopback port and destroys its disposable data afterward. The SLA boundary suite uses reflection only in test code to backdate incident creation rather than sleeping; production classes are unchanged.

## Visual assets

The cream/charcoal/sage palette, DM Serif Display page titles, Playfair Display sidebar categories, Ubuntu section/table/dialog headings, body text and controls, hover sidebar, and P1–P4 colors are preserved. Fonts load from Google Fonts with local fallbacks. Supplied icons were extracted and recolored; Vecteezy attribution and the source license information are retained.

## Technicians page

Select Technicians in the sidebar. The directory shows ID, name/email, normalized skills, effective availability, and the Java model's active-incident count. Search by name, ID, or skill; combine skill, availability, and workload filters. Sort by workload (lowest/highest), name, or ID. Summary totals describe the full directory, not filtered rows.

Select a technician ID for details. Administrators can add skills with `Technician.addSkill()` and change availability with `Technician.setAvailable()`. Employees and technicians have a read-only directory. No new technician accounts, deletion, skill removal, or manual workload editing is introduced. These would require separate scope and backend work.

The assigned-incidents section applies the existing role authorization: administrators see all assignments, a technician sees their own, and employees see their own reported incidents. Other queue details are withheld. Active assignment counts can therefore exceed the visible queue. Closed incidents are hidden by default; select All assignments to include them. Incident links open the existing Incidents detail flow.

Availability changes affect both skill-based and load-based assignment immediately. Marking a technician unavailable does not remove or block work on existing assignments. Adding a skill normalizes uppercase and avoids duplicates via the existing model. An unavailable technician's workload is retained. Active counts fall on closure, not resolution.

Additional authenticated endpoints:

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/technicians` | Directory, category suggestions, server-derived management permission |
| GET | `/api/technicians/{id}` | Technician details and role-scoped assigned incidents |
| POST | `/api/technicians/{id}/availability` | Admin only; `available=true` or `available=false` |
| POST | `/api/technicians/{id}/skills` | Admin only; nonblank `skill` |

The extended API test suite covers read/write authorization, invalid updates, skill normalization, duplicate handling, role-scoped incident links, workload preservation, and assignment results after availability/skill changes.

For the current review, the updated app runs at http://127.0.0.1:8081 (`.\start-web.ps1 -Port 8081`). The older process at port 8080 was preserved because it contained an incident in memory. The two processes have separate data and sessions; records are not migrated between them. The launcher still defaults to port 8080 when used without arguments.

## SLA monitoring page

Select SLA monitoring in the sidebar. This frontend-only page reuses `/api/incidents` and `/api/escalate`, so it requires no additional API routes or server restart.

- The backend supplies response/resolution deadlines and the exact SLA classification. The browser does not recalculate risk or breach policy.
- Active summary counts exclude RESOLVED, VERIFIED, and CLOSED. Counts describe all role-visible active incidents, independently of table filters.
- Search ID/title and combine SLA status, priority, technician (including unassigned), and active/completed/all lifecycle filters.
- Default sorting puts breached active incidents first, then at-risk, then other active incidents. Ties use the pending deadline, priority, and incident ID. Other choices are earliest pending deadline, highest priority, and ID.
- Response cells display the deadline and acknowledgement timestamp when present. Resolution cells display the deadline and resolution timestamp when present. A recorded acknowledgement is not labeled as historically compliant: the existing backend provides current status, not a full historical compliance metric.
- Java's combined SLA label gives response breaches precedence over resolution breaches. Filters and labels preserve that behavior. The page does not infer a second simultaneous breach state.
- Optional automatic refresh fetches fresh backend values every 30 seconds while this page and browser tab are visible. It pauses when you navigate away, hide the tab, or sign out. A failed refresh keeps the previous snapshot and clearly marks it stale. There is also a manual Refresh button.
- Only administrators see Check SLA breaches. It invokes the existing explicit escalation pass across the full register, unaffected by UI filters. Auto refresh only reads data; it never escalates incidents. Existing assigned/escalated recovery limitations still apply.
- Incident IDs open the existing role-authorized incident details. Employees monitor their own reports, technicians their assigned queue, and admins the full register.
- The expandable target table documents the current fixed targets in `SLAService.java`. It is read-only; Java's returned deadlines remain authoritative.

Run the frontend view tests with `node tests/sla_view_test.cjs`. They cover summary scope, exact backend states, combined filters, completed incidents, pending deadlines, ordering and non-mutating view sorting. `ServiceContractTest` covers the Java risk and breach boundaries and escalation behavior. Browser checks used an isolated disposable server for pending/acknowledged deadline rows and incident links; no test records were added to the existing application servers.

## Reports and Audit trail

These frontend-only pages use the existing same-origin API; no server restart or extra routes are required.

### Reports

`GET /api/incidents` supplies the authorized incident snapshot and technician metadata. The frontend applies the same summary grouping as `ReportService.printIncidentSummary`: CLOSED is closed; RESOLVED and VERIFIED are resolved; all other lifecycle states are open. Priority totals include all filtered incident states, matching the existing backend summary.

Creation-date, category, and priority filters apply to summary totals, both breakdown tables, and the incident list/CSV. Date endpoints are inclusive and invalid ranges are explained. Current technician workload is intentionally not filtered by creation dates or incident categories: it displays the live `activeIncidentCount` supplied by Java, including resolved/verified work that is not yet closed. That independent scope is labeled on the page. The workload table opens the existing Technicians page; incident IDs open details.

CSV export contains all included incidents, ordered like the table. Exports escape commas, quotes and newlines, include UTF-8 BOM for spreadsheet compatibility, and neutralize formula-leading cells. Export is disabled for empty, incomplete, or stale snapshots.

### Audit trail

The page first gets the authorized incident list, then requests `/api/incidents/{id}` for each visible incident and uses the `history` returned by `AuditService.getLogsForIncident`. At most four history requests run per load. It publishes a new snapshot only when all requested histories succeed; a failure retains the previous complete snapshot, marks it stale, and disables export. Navigation or identity changes invalidate pending loads. No backend actions or audit entries are fabricated.

Search covers incident ID/title, action, actor ID, state names, and descriptions. Action, actor and inclusive activity-date filters combine. Events default to newest first, preserving entry order for equal timestamps, and paginate in groups of 25. Summary counts describe the complete accessible history, independently of filters. CSV exports contain every filtered event, not just the current page. History is read-only; there are no edit/delete controls.

Administrators aggregate histories across all incidents. Employees and technicians see only incidents permitted by the existing server authorization. Actor names fall back to IDs when a user's directory metadata isn't available. Only incident actions already recorded by the Java adapter appear; logins and technician availability/skill updates are not incident audit records.

Run `node tests/reports_audit_view_test.cjs` for 30 assertions covering summary grouping, date boundaries, combined filters, chronological ordering, bounded batch loading, incomplete/canceled history behavior, and CSV safety. Browser verification used an isolated disposable server with three incidents and 37 history records, and confirmed report totals, pagination, search and detail links. Existing application data was left untouched.

## Notification inbox

Notifications is now a working in-app inbox using the current account's real messages from `/api/incidents`. The existing Incidents notification button opens this same page. No additional Java routes or server restart are required.

- Each entry has a brief, timestamp, source label, and expandable full message. Clicking the entry marks it read. Unread entries are pale blue; read entries use the normal off-white surface.
- The sidebar's small red circle appears when any non-dismissed notification is unread. Counts update on shared incident snapshots, after local actions, and during a 30-second background check while the application tab is visible. Hidden tabs stop polling and refresh when visible again.
- The yellow hazard triangle indicates any P1 incident in the signed-in user's authorized incident register. It is independent of notification read/delete status, and remains for completed P1 incidents too, matching the requested presence rule. It disappears when the backend snapshot contains no visible P1 incidents.
- Choose Latest first or Oldest first; the choice is saved per account. Backend and simulated entries are ordered together by their timestamps.
- Right-click a notification and choose Delete notification, use its actions button, or swipe/drag it left. Vertical touch scrolling and short/rightward drags do not delete. The keyboard context-menu key or Shift+F10 opens the same menu; Escape dismisses it.
- Clear all notifications dismisses the current inbox, including unread entries. Mark all as read clears unread status without deleting. Delete and Clear all provide a one-step Undo while that feedback remains available. A newly arriving message after clearing is still unread.
- Send test notification adds an explicitly labeled simulated entry for the current browser account. It exercises the same read, sort, swipe, menu and clear controls without creating or changing an incident. Two simulated examples are left in the admin preview for reviewing read/unread styling.

### State and limits

The Java `NotificationService` stores strings and has no stable IDs, read-state methods or deletion methods. The frontend derives stable keys from each complete source string plus an occurrence count, preserving even identical duplicate messages. Read IDs, dismissed IDs, simulated entries and ordering are stored in localStorage under a user-specific key, automatically separated by browser origin/port. Other tabs on the same origin receive storage updates. An unavailable/full localStorage falls back to in-memory state and explains the persistence limit.

Read and delete operations affect the browser inbox, not the Java notification collection. Dismissals survive refresh and sign-out/sign-in in this browser, but do not synchronize across devices or browsers. Incident histories and server records are not deleted. Simulated entries do not create P1 hazards; hazards come only from actual role-visible incidents. This implementation uses in-app polling, not external push/email or operating-system notifications.

Run `node tests/notifications_test.cjs` for 39 assertions covering parsing, duplicate identity, persistence, account separation, read/delete/undo behavior, new arrivals after clearing, oldest/latest ordering, storage failure fallback, P1 rules and swipe thresholds. Browser verification additionally covered click-to-read, right-click deletion, Undo, real pointer-drag deletion, clear-all persistence through refresh/reload, reverse ordering, and an isolated real P1 incident's icon markers. Existing backend incident data was not changed by these tests.

## Verification — 21 November 2026

The completed frontend was checked against the Java models/services, HTTP adapter and course brief. This verifies the implemented scope; it does not establish that every feature in the project brief is complete.

| Automated check | Passing assertions |
| --- | ---: |
| HTTP integration and authorization (`tests/web_api_test.py`) | 370 |
| Java SLA targets, boundaries and escalation (`tests/ServiceContractTest.java`) | 20 |
| Notification state and interactions (`tests/notifications_test.cjs`) | 39 |
| Reports, audit loading and CSV (`tests/reports_audit_view_test.cjs`) | 30 |
| SLA monitoring view (`tests/sla_view_test.cjs`) | 17 |
| Transport failures/cancellation and color contrast (`tests/transport_accessibility_test.cjs`) | 35 |
| **Total** | **511** |

Production Java compilation and frontend JavaScript syntax checks also passed. The transport tests execute the real `api.js` with controlled responses; view tests exercise frontend logic. These are not a claim of exhaustive browser or accessibility coverage.

Browser verification used a disposable server on port 8082, separate from the existing app on 8081. It covered required-field validation; reporting; skill-based assignment; technician acknowledgement/start; requesting employee information; employee information submission; resume; resolution; employee verification; and closure. Technician workload returned to zero on closure. A three-incident fixture confirmed highest-priority ordering, SLA active scope (two active), report counts (three total, two open, one closed), twelve audit events across three actors, real notifications, click-to-read, and the unread/P1 navigation indicators. The disposable server was stopped afterward; existing application records were not changed.

### Defects corrected during verification

- Pressing Enter in the Reporter ID filter no longer submits the filter form, reloads the page or loses the filter.
- API errors now preserve HTTP status even when error bodies contain malformed JSON, HTML or null. Invalid successful responses, cancellation and timeout receive distinct handling. Writes are not automatically retried.
- P2 retains the requested background color with black text for readable contrast. Keyboard focus uses charcoal on cream and sage on the dark sidebar.

### Requirements coverage and remaining gaps

| Area | Verified behavior or limitation |
| --- | --- |
| Incident workflow and authorization | Implemented UI follows backend transitions and server-derived actors; unsupported actions remain unavailable. |
| Priority and assignment | Backend scoring, all four SLA target pairs, skill/load strategies and workload semantics are covered. |
| Technician management | Directory, availability and adding skills are implemented. Creating users/technicians and broader administration are not implemented in the web UI. |
| SLA monitoring | Current backend status/deadlines and explicit admin escalation are exposed. There is no automatic escalation scheduler. |
| Reports and audit | Role-scoped counts and existing incident history are exposed. Login and technician-management audit events are not supplied by the backend. |
| Notifications | Real backend messages with simulated examples and browser-local read/dismissal state. Read/deletion state is not stored on the server or synchronized across devices. |
| Persistence | Backend records are in memory and reset when the server stops. Persistent storage required by the brief is still missing. |
| Other web modules | Overview remains a placeholder. Registration and user/service/category/SLA administration are not completed web modules. |

Two backend limitations were reproduced with `tests/BackendRequirementsProbe.java`, using isolated records and a test-only adjusted creation time:

1. An assigned incident that is escalated cannot subsequently be acknowledged or reassigned through the existing service. A recovery transition/policy is needed in the backend.
2. A late acknowledgement clears the current response-breach classification. `SLAService` does not retain historical response compliance, so the UI cannot honestly calculate that metric from the current label.

The probe reports these as gaps, not successful feature assertions. Production lifecycle and SLA policy were not changed during this frontend verification.

To run the added checks, use `node tests/transport_accessibility_test.cjs`. After compiling the application, compile both Java checks with `javac -cp .build/classes -d .build/test-classes tests/ServiceContractTest.java tests/BackendRequirementsProbe.java`, then run `java -cp ".build/classes;.build/test-classes" ServiceContractTest` and `java -cp ".build/classes;.build/test-classes" BackendRequirementsProbe`. On Windows the classpath separator is a semicolon.

## Overview page

The Overview placeholder listed in the earlier verification is now implemented. Select Overview in the sidebar. It uses the same palette and typography as the existing pages, with a left profile panel and a main activity area; narrow layouts stack the profile above the content.

- Employees see their name, role and ID. Technicians also see their email, current skills, availability and backend active-assignment count. Employee contact fields are not supplied by the existing API and are not invented. Administrators see a system overview panel and counts/activity across their accessible register.
- Open counts exclude RESOLVED, VERIFIED and CLOSED. Completed includes those three states, as labeled on the page. Awaiting your action counts tickets with the specific attention prompts below, not every backend action (adding optional information and resolving in-progress work are not counted).
- Needs your attention follows server-returned actions: employee requests for information, verification and closure; technician acknowledgement, starting and resuming investigation; administrator assignment. Links open the existing incident details and authorized actions. The frontend does not bypass permissions or change lifecycle rules.
- SLA warnings use the exact backend risk/breach strings, exclude completed tickets, and show up to three incidents with breaches first. The notice is hidden when none need attention.
- Recent activity shows the latest eight real audit events across accessible incidents, including creation and resolution. Continue recent ticket opens the incident with the latest recorded event; creation time is the fallback if there is no history. Completed tickets remain available through these links.
- View incidents opens the existing Incidents page. Employees can Report incident directly from Overview using the existing form, validation and priority preview. Other roles do not get a create button because the backend only permits employee creation.
- Refresh loads the authorized incident list, existing detail histories with at most four concurrent history reads, and the technician's own profile when applicable. A complete snapshot is published atomically. Errors keep the previous snapshot with a stale warning; initial errors show retry guidance. Leaving Overview or changing identity cancels pending work and prevents an obsolete response from replacing the current view. Signing out clears profile and ticket data. The page refreshes on entry, visible-tab return and shared incident updates; there is no new polling service.

No API routes or domain models were added. The history collector is shared with Audit trail. The current local server serves frontend files directly with cache revalidation, so reloading the app updates this page without restarting Java or clearing records.

Verification: `node tests/overview_view_test.cjs` passed 25 assertions covering role/action prompts, count semantics, completed SLA exclusions, warning ordering, recent-history ordering/limits, fallback selection, empty states and non-mutating views. The existing reports/audit suite passed all 30 assertions after sharing its history helper. Syntax checks passed for changed scripts. An isolated browser workflow verified employee empty state, reporting directly from Overview, live count/activity updates, the recent-ticket shortcut, administrator assignment prompts and links, technician contact/skills/workload, and the acknowledgement-to-start prompt transition. Test data was confined to a separate server on port 8082.

## Specific technician questions and employee replies

An assigned technician investigating a ticket can now enter a required question (up to 2000 characters) and choose Send information request. `POST /api/incidents/{id}/request-information` requires `question`; missing, blank and oversized questions are rejected before any state/history changes. The existing authorization and IN_PROGRESS → WAITING_FOR_EMPLOYEE transition remain authoritative.

Incident details include `informationRequests`, an ordered list containing each question, technician ID, asked timestamp and `replies` (employee ID, text and timestamp). Only the reporting employee can reply through the existing add-information action. While waiting, replies attach to the latest question and also retain the existing description/audit behavior. The employee sees the current question beside Your reply. The technician is notified of replies and explicitly resumes investigation; answering does not change status automatically. A subsequent information request creates a new exchange and preserves the previous one. Questions and replies are escaped as plain text in the UI.

The employee's notification includes the question; audit history records the question and answers. Existing generic information additions outside a waiting state remain supported. The original two-argument Java service method remains compatible with console callers using a default question; the web form always requires a specific question. These records share the application's existing in-memory storage, pending database integration.

The updated backend is running at **http://127.0.0.1:8083/**. The older process at 8081 is preserved with its original records; frontend code detects that older backend and prevents sending a question it cannot save. The new server has a labeled demo ticket, INC0001, assigned to tech1. A sample question and response were verified through the browser. No old records were migrated or overwritten.

Validation: the expanded HTTP suite passed **394 assertions**, including validation atomicity, authenticated authors, role restrictions, question-bearing notifications/audit, paired replies and multiple exchanges. Browser checks verified required-field validation, sending a question, employee reply context, saved question/answer display and technician resumption. Java compilation and incident-script syntax checks passed.

## Authentication, profiles and account administration

The latest app is running at **http://127.0.0.1:8084/**. Earlier local processes are preserved with their in-memory ticket data. No database or record migration was introduced.

`signin.html` and `signup.html` are standalone documents with charcoal backgrounds and no application sidebar, dashboard or login overlay. Opening the app without a valid session redirects to sign-in; the workspace stays hidden during the initial session check. Sign-out and session expiry also navigate to sign-in. A failed connection is explained there with a retry through the sign-in form.

Registration is intentionally a frontend preview pending database work. The sign-up form validates name, username, email, department, password length and confirmation. Check details explains that no account was created, then clears the password fields. It does not submit a registration request, save account details in browser storage or simulate a successful registration. Existing demo accounts can still sign in normally. Username uniqueness will be checked by registration's eventual backend integration, not claimed by the current preview.

Profile & account is accessible through the profile menu for every role. Users can edit their own name, username and email; employees can also edit department. Complete profile details now appear on the personal Overview panel. The server checks field lengths, username syntax, case-insensitive uniqueness and email format before applying any change. User ID, role and active status cannot be changed through a profile update. Renaming a username preserves user ID, assignments, audit attribution and service iteration order.

Change password requires the current password and an 8–128 character new password, with matching confirmation in the frontend. It retains the current session and revokes other sessions for that account. Password fields clear after success or navigation away. The existing course-project password model remains in use; passwords are not included in session/profile/directory responses.

The administrator-only Users page shows name, ID, username, role, email, employee department and account status. Search and combined role/status filters apply to the directory; counts describe the full directory. Activating/deactivating requires a confirmation explaining its effect. Deactivation ends that user's sessions and blocks sign-in; activation permits a fresh sign-in without reviving old sessions. Existing records are retained. The frontend displays server-provided reasons when deactivation is blocked. The backend independently prevents self-deactivation and deactivation of a technician with active assignments or an employee with any unclosed ticket. Account activation is distinct from technician availability.

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/session` | Current user's full safe profile |
| POST | `/api/profile` | Current user's name, username, email; employee department |
| POST | `/api/profile/password` | Current user; `currentPassword`, `newPassword` |
| GET | `/api/users` | Administrators only; safe directory and deactivation reasons |
| POST | `/api/users/{id}/active` | Administrators only; `active=true` or `active=false` |

Current administrator privileges are: view all incidents and incident audit history; assign eligible unassigned incidents using skill/load strategies; manually reassign assigned active incidents (including escalated tickets) to another available technician; view reports and SLA monitoring; run the explicit SLA escalation pass; view technicians, add skills and change assignment availability; view registered users and activate/deactivate eligible accounts; edit their own profile/password and use their own notification inbox. Administrators cannot impersonate employees/technicians to report, acknowledge, investigate, resolve, verify or close tickets. They cannot edit another user's profile/password, change roles, delete tickets or configure SLA targets/categories/services.

Verification for this update: **640 passing automated assertions** (442 HTTP integration, 21 authentication-page/form, 11 user-directory view, 39 notifications, 30 reports/audit, 17 SLA view, 25 Overview, 35 transport/contrast and 20 Java SLA/service checks), plus Java compilation and frontend syntax checks. Browser checks verified the standalone sign-in redirect, invalid credentials, sign-up required-field validation and pending-registration notice, employee profile saving/restoration, full Overview details, hidden employee admin navigation, admin directory/search, deactivation confirmation, reactivation and restored counts. Password changes and username credential changes were verified with disposable API tests rather than changing demo credentials through the browser. The demo department and activated account were restored after browser testing.

## Persistent storage integration

The supplied files are a Python standard-library SQLite adapter, SQL schema and sample database, not MySQL/JDBC code. The latest Java backend now uses that adapter. No old backend files replaced the updated web adapter, domain workflows or frontend. The launcher copies the sample once to `data/itsm.sqlite`, which is the live database for http://127.0.0.1:8085/. On 22 November 2026, the live and sample databases were cleared of incidents, audit history, notifications, questions and replies for a clean distribution. Existing accounts, skills and technician settings were retained. Ignored local backups are under `.build/local-backups`, outside the distributable files.

The launcher defaults to persistence. `-DatabasePath` selects another local file, `-PythonPath` selects a Python interpreter, and `-InMemory` explicitly selects temporary test mode. Direct Java invocation accepts `PORT --database PATH --python PYTHON`; omitting the database argument is intended for existing isolated API tests. Python requires no third-party modules. Startup fails if storage cannot be opened or restored; it does not silently replace stored records with demo data.

Persisted data includes users and salted PBKDF2 password hashes, profile fields, active flags, raw technician availability preferences, skills, incidents and their status/assignment/priority, original lifecycle timestamps, SLA deadlines, resolution notes, audit entries, notification strings, technician questions and paired employee replies. Technician workload is rebuilt from assigned, unclosed incidents. The provided sample's legacy password encoding is supported; its four original demo logins were verified. Stored passwords are never returned by APIs.

Two additive tables, `information_requests` and `information_replies`, extend the supplied schema. Existing tables and historical records retain their fields. SQLite schema initialization is idempotent. The revision counter remains an optimistic concurrency token rather than a schema version.

Every successful domain mutation commits a transaction before the HTTP success response. Failed saves restore the previous in-memory state and return an error; the frontend does not claim success or automatically retry writes. If a response is lost after a successful commit, the committed state remains authoritative. The supplied revision check prevents a second stale process from replacing newer records; that process reloads the database and requires a fresh sign-in after the conflict. Use one server per database for normal operation because reads use each process's loaded state.

`POST /api/register` now creates a persistent EMPLOYEE account with validated name, username, email, department and an 8–128 character password. Username uniqueness is checked case-insensitively. User ID, role and active state are server-derived, and IDs account for the imported database's existing identifiers. Sign-up calls this endpoint, clears passwords and redirects to sign-in after success. `GET /api/capabilities` exposes whether this server has registration enabled. Temporary in-memory servers reject registration with a clear unavailable response. The former Check details preview and pending-registration message have been removed.

Sessions are intentionally transient and expire on server restart. Browser notification read/dismissed/order state remains local to the account and origin as previously designed; backend notification messages themselves are persisted with their original identity strings. Existing SLA policy and the assigned-escalation recovery limitation described earlier were not redesigned by storage integration. The console program remains a separate in-memory entry point.

Storage integration was originally verified with 728 passing assertions across the database, API, frontend and Java service suites, plus compilation and syntax checks. Database tests operate only on temporary sample copies and verify that the source sample's file hash is unchanged during tests. Since the clean-slate reset, historical test fixtures are created inside those temporary copies rather than shipped as incidents. Earlier browser checks confirmed the active registration form, imported-account sign-in, real ticket creation, and recovery of the same ticket/history/deadlines after restarting the actual local server; that browser test incident has now been removed from the live database.

Run the durable checks after compilation with `python tests/storage_integration_test.py --java PATH_TO_JAVA`. Back up the live database with the server stopped, retain it when moving the project, and restart on the same port to retain browser-local notification preferences. Previous in-memory servers were left intact; their transient records were not silently merged into the persistent database.

## Manual reassignment

Administrators can now reassign incidents in ASSIGNED, ACKNOWLEDGED, IN_PROGRESS, WAITING_FOR_EMPLOYEE or ESCALATED. Unassigned and completed (RESOLVED/VERIFIED/CLOSED) tickets do not offer this action. Open incident details and select a different technician under Available actions. Selecting an option opens the confirmation automatically; Review reassignment can reopen it after cancellation. Cancel changes nothing. Confirm reassignment sends the request once, with controls disabled while saving.

The dropdown uses native skill optgroups and lists each technician once. The backend has a skill set rather than a dedicated main-skill field, so the presentation chooses the first known skill in category order (NETWORK, HARDWARE, SOFTWARE, EMAIL, ACCESS, OTHER), then custom skills alphabetically; technicians without skills have their own group. Full skills, name, ID, username and active workload are shown. The current technician and unavailable/inactive technicians cannot be selected. A manual admin transfer may cross skill categories; the confirmation explicitly warns when the destination does not list the incident category.

The confirmation names both technicians and warns that ownership moves, status returns to Assigned, the new owner must acknowledge, earlier work remains, and SLA deadlines do not reset. `POST /api/incidents/{id}/reassign` requires `technicianId`, `expectedTechnicianId` and `expectedStatus`. Server-side role, lifecycle, destination availability and expected-owner/status checks protect against unauthorized or stale confirmations. No new account/skill/settings or database schema are needed.

The service transfers exactly one active workload from the previous technician to the new one. Description, question/reply exchanges, history, original creation/response timestamps and both SLA deadlines are retained. A new owner's acknowledgement does not replace an already-recorded first response timestamp. Audit history records REASSIGN with the previous/new states and technician IDs; the previous technician, new technician and employee receive in-app notifications. Old-owner access ends immediately, and the new owner starts with Acknowledge. SQLite commits reassignment, audit and notifications together and rebuilds workload correctly after restart.

This also supplies an admin recovery path for assigned escalated tickets when another available technician exists; the older limitation notes above describe the previous implementation. Historical SLA compliance remains limited by the existing SLA service.

Verification: 489 HTTP/API assertions, 98 SQLite/restart/failure assertions, 17 Java reassignment lifecycle/workload assertions and 15 frontend grouping/eligibility/warning assertions passed. Browser checks on a disposable server confirmed Network/Hardware groups, disabled current-owner choice, automatic confirmation on selection, the cross-skill warning, Cancel preserving T001, Confirm switching to T002 with username/ID, and the REASSIGN audit entry. No incidents were added to the live or distributable databases during verification.


## Current visual and profile update

The current draft uses Graphite and Emerald with Plus Jakarta Sans headings, Inter UI text and JetBrains Mono ticket IDs. `theme-graphite.css` is the active stylesheet; `theme-indigo.css` preserves the preceding draft. Navigation uses locally embedded Lucide SVGs, with license and source notices under `assets/icons/lucide/`.

Sign-in opens Overview. Overview charts show category totals and daily reporting frequency over the last 30 days, restricted to the signed-in user's accessible incidents. Category changes animate, with reduced-motion support. AI anomaly detection is not implemented.

Profile editing supports an optional phone number and profile picture alongside the existing name, username, email and employee department fields. Images are cropped/resized to 160 pixels square in the browser and sent as JPEG data URLs. The backend validates image content, dimensions and size; optional `phone` and `profilePicture` fields on `POST /api/profile` are stored in the additive `profile_details` table. Omitting these fields preserves existing values. Password fields are hidden until Change password is selected.

P1 incidents have pale red rows and retain explicit priority labels. A warning icon and label appear beside the Critical count when any accessible P1 incident exists. Summary counts continue to cover the full role-visible register, independent of table filters.
