"""Seed realistic simulation data into the I-ITSM SQLite database.

Usage (stop the Java server first):
    python database/seed_test_data.py                      # seeds data/itsm.sqlite
    python database/seed_test_data.py path/to/other.sqlite

Adds employees, technicians (with skills), ~80 incidents across ALL categories
(NETWORK, HARDWARE, SOFTWARE, EMAIL, ACCESS, OTHER) spread over 01 Sep - 22 Nov 2026,
in every lifecycle status, with matching audit trail, notifications, SLA deadlines,
information requests/replies, SLA breaches and duplicate/related incident clusters.
Existing rows (admin, employee, tech1, tech2, newuser, INC0001) are kept.
Every seeded account's password is:  pass1234
"""
import base64, hashlib, os, random, sqlite3, sys
from datetime import datetime, timedelta
from pathlib import Path

random.seed(2026)
NOW = datetime(2026, 11, 22, 12, 0, 0)
START = datetime(2026, 9, 1, 8, 0, 0)
PASSWORD = "pass1234"
ITER = 210000

def pw_hash(password):
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITER, 32)
    return f"pbkdf2-sha256${ITER}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"

SLA = {"P1": (5, 30), "P2": (15, 120), "P3": (60, 480), "P4": (240, 1440)}
def priority(i, u, c):
    s = i * u * c
    return "P1" if s >= 75 else "P2" if s >= 40 else "P3" if s >= 15 else "P4"

# ---------------------------------------------------------------- people
EMPLOYEES = [
    ("E002", "Aarav Sharma", "aarav", "Finance"), ("E003", "Priya Nair", "priya", "HR"),
    ("E004", "Rohan Mehta", "rohan", "Sales"), ("E006", "Sneha Reddy", "sneha", "Engineering"),
    ("E007", "Karthik Iyer", "karthik", "Engineering"), ("E008", "Ananya Das", "ananya", "Marketing"),
    ("E009", "Vikram Singh", "vikram", "Operations"), ("E010", "Meera Pillai", "meera", "Finance"),
    ("E011", "Arjun Kapoor", "arjun", "Sales"), ("E012", "Divya Menon", "divya", "Legal"),
]
TECHS = [  # id, name, username, skills, available
    ("T003", "Suresh Kumar", "tech3", ["EMAIL", "ACCESS"], 1),
    ("T004", "Neha Verma", "tech4", ["SOFTWARE", "ACCESS"], 1),
    ("T005", "Imran Khan", "tech5", ["NETWORK", "HARDWARE"], 1),
    ("T006", "Lakshmi Rao", "tech6", ["SOFTWARE", "EMAIL", "OTHER"], 0),
]
TECH_BY_CAT = {
    "NETWORK": ["T001", "T005"], "HARDWARE": ["T002", "T005"], "SOFTWARE": ["T002", "T004", "T006"],
    "EMAIL": ["T001", "T003", "T006"], "ACCESS": ["T002", "T003", "T004"], "OTHER": ["T006", "T004"],
}
ALL_EMP = ["E001", "E005"] + [e[0] for e in EMPLOYEES]

# ---------------------------------------------------------------- templates
# category -> list of (title, description, resolution, (impact,urgency,criticality) range hint)
T = {
 "NETWORK": [
  ("VPN keeps disconnecting", "Remote staff lose VPN connection every few minutes while working from home.", "Updated VPN gateway firmware and increased idle timeout.", (3, 4, 4)),
  ("Office Wi-Fi extremely slow on 3rd floor", "Wi-Fi speeds below 1 Mbps on the third floor since morning.", "Replaced faulty access point and re-tuned channel plan.", (3, 3, 3)),
  ("Cannot reach internal wiki", "Internal wiki times out from the HQ network but works over VPN.", "Fixed stale DNS record on internal resolver.", (2, 3, 2)),
  ("Branch office link down", "Entire Pune branch has no connectivity to head office.", "ISP restored the leased line; router interface reset.", (5, 5, 5)),
  ("Intermittent packet loss to data centre", "Ping to data-centre servers shows 20% packet loss.", "Replaced failing SFP module on core switch.", (4, 4, 4)),
  ("Printer network unreachable", "Network printers on floor 2 not discoverable.", "Corrected VLAN assignment on switch port.", (2, 2, 1)),
 ],
 "HARDWARE": [
  ("Laptop battery drains in under an hour", "Battery drops from 100% to 0 within an hour.", "Battery replaced under warranty.", (2, 2, 2)),
  ("Monitor flickering", "External monitor flickers and goes black randomly.", "Replaced HDMI cable and updated GPU driver.", (1, 2, 1)),
  ("Desktop will not boot", "Workstation shows black screen with beeps on startup.", "Reseated RAM modules; replaced one faulty DIMM.", (3, 4, 3)),
  ("Keyboard keys unresponsive", "Several keys on the laptop keyboard do not register.", "Keyboard assembly replaced.", (1, 2, 1)),
  ("Server fan failure alarm", "Rack server B4 raising high temperature alarm.", "Replaced failed chassis fan; temperature normal.", (4, 5, 5)),
  ("Docking station not detecting displays", "Dock powers laptop but no display output.", "Firmware update on dock resolved detection.", (2, 3, 2)),
 ],
 "SOFTWARE": [
  ("Payment application unavailable", "The organization's payment application is down; users cannot complete transactions.", "Restarted payment service and rolled back faulty release 4.2.1.", (5, 5, 5)),
  ("ERP crashes on invoice export", "ERP client crashes whenever exporting invoices to PDF.", "Installed patch 12.4.3 fixing the PDF export bug.", (3, 4, 4)),
  ("IDE licence expired", "JetBrains IDE shows licence expired for the dev team.", "Renewed and redistributed team licences.", (2, 3, 2)),
  ("Excel macros blocked after update", "Finance macros blocked after Office update.", "Added trusted location via group policy.", (3, 3, 3)),
  ("CRM dashboard shows wrong totals", "Monthly sales totals in CRM differ from finance records.", "Corrected faulty aggregation query and refreshed cache.", (4, 3, 4)),
  ("Antivirus blocking internal tool", "Endpoint antivirus quarantines the internal deploy tool.", "Added tool to antivirus allow-list.", (2, 3, 2)),
  ("Database timeouts in reporting app", "Reports time out after 30 seconds; DB queries are slow.", "Added missing index and tuned connection pool.", (4, 4, 4)),
 ],
 "EMAIL": [
  ("Cannot send emails with attachments", "Outlook hangs when sending emails larger than 5 MB.", "Increased mailbox transport size limit.", (2, 3, 2)),
  ("Mailbox full", "Mailbox quota exceeded; incoming mail is bouncing.", "Quota increased and archive enabled.", (2, 3, 2)),
  ("Emails delayed by hours", "Company-wide emails arriving 2-3 hours late.", "Cleared stuck queue on mail relay.", (4, 4, 5)),
  ("Calendar invites not syncing to phone", "Meeting invites missing on mobile.", "Re-added account profile on device.", (1, 2, 1)),
  ("Phishing email reported", "Suspicious email asking for credentials received by several staff.", "Sender blocked, mail purged, awareness note sent.", (4, 5, 4)),
 ],
 "ACCESS": [
  ("Account locked after password reset", "Cannot log in after resetting password; account locked.", "Unlocked account and synced directory.", (2, 4, 2)),
  ("No access to finance shared drive", "New joiner cannot open the finance shared drive.", "Added user to Finance-ReadWrite group.", (2, 3, 3)),
  ("MFA codes not arriving", "SMS codes for multi-factor login never arrive.", "Re-registered authenticator app for the user.", (2, 4, 3)),
  ("SSO login loop", "Single sign-on redirects endlessly to login page.", "Cleared stale session cookies and fixed IdP clock skew.", (4, 4, 4)),
  ("Admin console access request", "Need temporary admin access for deployment window.", "Granted time-boxed admin role after approval.", (1, 2, 2)),
 ],
 "OTHER": [
  ("Request for second monitor", "Requesting an additional monitor for the design workstation.", "Monitor allocated from spares.", (1, 1, 1)),
  ("Conference room AV not working", "Projector in Room 4 shows no signal from any laptop.", "Replaced faulty HDMI switcher.", (2, 3, 2)),
  ("Badge reader not recognising cards", "Main entrance badge reader rejects valid cards.", "Rebooted controller and resynced cards.", (3, 3, 3)),
  ("Software installation request", "Need Tableau installed for analytics project.", "Installed Tableau via software centre.", (1, 2, 1)),
 ],
}

# clusters of near-duplicate reports (for duplicate / correlation demos)
CLUSTERS = [
  ("SOFTWARE", [("Payment application unavailable", "Payment app is down, nobody can transact."),
                ("Payment transaction failing", "Customers get an error when completing payment."),
                ("Unable to make payment", "Checkout payment fails with a timeout error.")],
   "Restarted payment gateway service and rolled back release 4.2.1.", (5, 5, 5), datetime(2026, 10, 14, 10, 5)),
  ("NETWORK", [("VPN not connecting", "VPN client fails at authentication step."),
               ("Unable to connect to VPN from home", "VPN connection times out from home network."),
               ("VPN gateway timeout", "Gateway timeout when connecting to VPN.")],
   "VPN concentrator license exhausted; capacity increased.", (4, 4, 4), datetime(2026, 11, 3, 9, 20)),
  ("EMAIL", [("Outlook not receiving mail", "No new mail since this morning."),
             ("Emails delayed", "Incoming emails delayed by hours."),
             ("Mail queue stuck", "Mails stuck in outbox and not delivered.")],
   "Cleared stuck queue on mail relay and restarted transport service.", (4, 4, 5), datetime(2026, 11, 18, 14, 10)),
]

AUDIT, NOTES, INCIDENTS, REQS, REPLIES = [], [], [], [], []
ts = lambda d: d.isoformat()
def note(who, when, msg): NOTES.append((who, f"{ts(when)} | To: {who} | {msg}"))
def log(when, actor, action, inc, prev, cur, desc): AUDIT.append((ts(when), actor, action, inc, prev, cur, desc))

def add_incident(n, reporter, title, desc, cat, imp, urg, crit, created, final_status, resolution, tech=None, admin="A001"):
    """Build an incident that walked the lifecycle up to final_status, writing audit + notifications."""
    inc = f"INC{n:04d}"
    pr = priority(imp, urg, crit)
    resp_m, reso_m = SLA[pr]
    resp_due, reso_due = created + timedelta(minutes=resp_m), created + timedelta(minutes=reso_m)
    # --- timeline (some incidents are deliberately slow -> SLA breaches)
    slow = random.random() < 0.25
    t_assign = created + timedelta(minutes=random.randint(1, 4))
    t_ack = t_assign + timedelta(minutes=random.randint(2, resp_m + 20 if slow else max(2, resp_m - 1)))
    t_start = t_ack + timedelta(minutes=random.randint(2, 20))
    t_res = t_start + timedelta(minutes=random.randint(10, int(reso_m * (1.8 if slow else 0.8)) + 10))
    t_ver = t_res + timedelta(minutes=random.randint(10, 600))
    t_close = t_ver + timedelta(minutes=random.randint(5, 240))
    order = ["NEW", "CLASSIFIED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "VERIFIED", "CLOSED"]

    log(created, reporter, "CREATE_INCIDENT", inc, "NONE", "CLASSIFIED", "Incident reported.")
    note(reporter, created, f"Incident {inc} has been created with priority {pr}.")
    status, ack, res, clo = "CLASSIFIED", None, None, None
    if final_status == "ESCALATED":
        tt = resp_due + timedelta(minutes=random.randint(1, 30))
        log(tt, admin, "AUTO_ESCALATE", inc, "CLASSIFIED", "ESCALATED", "Escalated due to SLA breach.")
        note("A001", tt, f"Incident {inc} escalated: SLA breached and no technician assigned.")
        status = "ESCALATED"
    elif final_status != "CLASSIFIED":
        tech = tech or random.choice(TECH_BY_CAT[cat])
        status = "ASSIGNED"
        strat = random.choice(["Skill-based", "Load-based"])
        log(t_assign, admin, "ASSIGN_INCIDENT", inc, "CLASSIFIED", "ASSIGNED", f"Assigned using {strat} assignment")
        note(tech, t_assign, f"Incident {inc} has been assigned to you.")
        if final_status != "ASSIGNED":
            ack = t_ack; log(t_ack, tech, "ACKNOWLEDGE", inc, "ASSIGNED", "ACKNOWLEDGED", "Technician updated incident.")
            note(reporter, t_ack, f"Incident {inc} status is now ACKNOWLEDGED."); status = "ACKNOWLEDGED"
        if final_status not in ("ASSIGNED", "ACKNOWLEDGED"):
            log(t_start, tech, "START", inc, "ACKNOWLEDGED", "IN_PROGRESS", "Technician updated incident.")
            note(reporter, t_start, f"Incident {inc} status is now IN_PROGRESS."); status = "IN_PROGRESS"
        if final_status == "WAITING_FOR_EMPLOYEE":
            q_at = t_start + timedelta(minutes=10)
            q = random.choice(["Could you share a screenshot of the error message?", "When did this first start happening?", "Does it also happen on another device?"])
            log(q_at, tech, "REQUEST_INFORMATION", inc, "IN_PROGRESS", "WAITING_FOR_EMPLOYEE", f"Technician question: {q}")
            note(reporter, q_at, f"Incident {inc} needs your information. Question: {q}")
            REQS.append((inc, 1, tech, q, ts(q_at))); status = "WAITING_FOR_EMPLOYEE"
        if final_status in ("RESOLVED", "VERIFIED", "CLOSED"):
            # optional Q&A cycle before resolving
            if random.random() < 0.3:
                q_at = t_start + timedelta(minutes=5); r_at = q_at + timedelta(minutes=random.randint(5, 40))
                q = "Please confirm which workstation or location is affected."
                a = "It is happening on my laptop in the main office, floor 3."
                log(q_at, tech, "REQUEST_INFORMATION", inc, "IN_PROGRESS", "WAITING_FOR_EMPLOYEE", f"Technician question: {q}")
                note(reporter, q_at, f"Incident {inc} needs your information. Question: {q}")
                log(r_at, reporter, "ADD_INFORMATION", inc, "WAITING_FOR_EMPLOYEE", "WAITING_FOR_EMPLOYEE", a)
                note(tech, r_at, f"Employee replied to incident {inc}: {a}")
                log(r_at + timedelta(minutes=1), tech, "RESUME", inc, "WAITING_FOR_EMPLOYEE", "IN_PROGRESS", "Technician updated incident.")
                REQS.append((inc, 1, tech, q, ts(q_at))); REPLIES.append((inc, 1, 1, reporter, a, ts(r_at)))
                t_res = max(t_res, r_at + timedelta(minutes=15))
            res = t_res; log(t_res, tech, "RESOLVE", inc, "IN_PROGRESS", "RESOLVED", resolution)
            note(reporter, t_res, f"Incident {inc} has been resolved."); status = "RESOLVED"
        if final_status in ("VERIFIED", "CLOSED"):
            log(t_ver, reporter, "VERIFY", inc, "RESOLVED", "VERIFIED", "Employee verified resolution."); status = "VERIFIED"
        if final_status == "CLOSED":
            clo = t_close; log(t_close, reporter, "CLOSE", inc, "VERIFIED", "CLOSED", "Incident closed.")
            note(reporter, t_close, f"Incident {inc} status is now CLOSED."); status = "CLOSED"
    if final_status not in ("RESOLVED", "VERIFIED", "CLOSED"):
        resolution = None
    INCIDENTS.append((inc, reporter, title, desc, cat, imp, urg, crit, pr, status, tech if final_status not in ("CLASSIFIED", "ESCALATED") else None,
                      ts(created), ts(ack) if ack else None, ts(res) if res else None, ts(clo) if clo else None, resolution, ts(resp_due), ts(reso_due)))
    # SLA breach notes for demo
    if ack and ack > resp_due: note(admin, ack, f"SLA response breached for incident {inc} ({pr}).")
    if res and res > reso_due: note(admin, res, f"SLA resolution breached for incident {inc} ({pr}).")

def rand_time(lo=START, hi=NOW - timedelta(days=1)):
    d = lo + (hi - lo) * random.random()
    d = d.replace(hour=random.randint(8, 18), minute=random.randint(0, 59), second=random.randint(0, 59), microsecond=0)
    if d.weekday() >= 5: d -= timedelta(days=d.weekday() - 4)
    return d

def build(first_no):
    n = first_no
    # 1) clusters (duplicate/related reports) - first one is the lead, others come minutes later
    for cat, items, resolution, (i, u, c), t0 in CLUSTERS:
        status = "CLOSED" if t0 < datetime(2026, 11, 10) else "IN_PROGRESS"
        shared_tech = random.choice(TECH_BY_CAT[cat])
        for k, (title, desc) in enumerate(items):
            add_incident(n, random.choice(ALL_EMP), title, desc, cat, i, u, c, t0 + timedelta(minutes=k * random.randint(3, 9)),
                         status, resolution, tech=shared_tech); n += 1
    # 2) historical incidents across all categories / statuses
    pool = [(cat, t) for cat, lst in T.items() for t in lst]
    plan = ["CLOSED"] * 38 + ["VERIFIED"] * 4 + ["RESOLVED"] * 5 + ["IN_PROGRESS"] * 7 + ["ACKNOWLEDGED"] * 4 + \
           ["ASSIGNED"] * 3 + ["WAITING_FOR_EMPLOYEE"] * 4 + ["ESCALATED"] * 3 + ["CLASSIFIED"] * 3
    random.shuffle(pool); 
    for idx, st in enumerate(plan):
        cat, (title, desc, resolution, (i, u, c)) = pool[idx % len(pool)] if idx < len(pool) else random.choice(pool)
        i, u, c = [max(1, min(5, x + random.choice([-1, 0, 0, 1]))) for x in (i, u, c)]
        if st == "CLOSED" or st in ("VERIFIED", "RESOLVED"):
            created = rand_time(START, NOW - timedelta(days=3))
        else:  # open tickets are recent so the dashboard has live work
            created = rand_time(NOW - timedelta(days=5), NOW - timedelta(hours=2))
        add_incident(n, random.choice(ALL_EMP), title, desc, cat, i, u, c, created, st, resolution); n += 1
    return n

def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/itsm.sqlite")
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        import shutil; shutil.copy(Path(__file__).with_name("sample.sqlite"), path)
    db = sqlite3.connect(path); db.execute("PRAGMA foreign_keys=ON")
    db.executescript(Path(__file__).with_name("schema.sql").read_text())
    if db.execute("SELECT 1 FROM accounts WHERE id='E002'").fetchone():
        sys.exit("Seed data already present - aborting to avoid duplicates.")
    last = db.execute("SELECT MAX(CAST(SUBSTR(id,4) AS INTEGER)) FROM incidents").fetchone()[0] or 0
    with db:
        for eid, name, user, dept in EMPLOYEES:
            db.execute("INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?)", (eid, name, user, pw_hash(PASSWORD), f"{user}@iitsm.local", "EMPLOYEE", dept, 1, None))
        for tid, name, user, skills, avail in TECHS:
            db.execute("INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?)", (tid, name, user, pw_hash(PASSWORD), f"{user}@iitsm.local", "TECHNICIAN", None, 1, avail))
            for s in skills: db.execute("INSERT INTO skills VALUES(?,?)", (tid, s))
        build(last + 1)
        INCIDENTS.sort(key=lambda r: r[11])
        db.executemany("INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", INCIDENTS)
        db.executemany("INSERT INTO audit VALUES(?,?,?,?,?,?,?)", sorted(AUDIT))
        db.executemany("INSERT INTO notifications VALUES(?,?)", sorted(NOTES, key=lambda r: r[1]))
        db.executemany("INSERT INTO information_requests VALUES(?,?,?,?,?)", REQS)
        db.executemany("INSERT INTO information_replies VALUES(?,?,?,?,?,?)", REPLIES)
        db.execute("UPDATE revision SET version=version+1")
    print(f"Seeded {len(INCIDENTS)} incidents, {len(AUDIT)} audit rows, {len(NOTES)} notifications into {path}")

if __name__ == "__main__":
    main()
