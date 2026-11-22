"""Real SQLite adapter, imported sample, restart persistence and failure/conflict checks.
All changes are restricted to a temporary database; the supplied sample is read-only.
"""
import argparse
import hashlib
import http.cookiejar
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--java', default='java')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
processes = []
checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1

def start(database):
    process = subprocess.Popen([args.java, '-cp', '.build/classes', 'itsm.web.WebServer', '0', '--database', str(database), '--python', sys.executable], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    processes.append(process)
    line = process.stdout.readline()
    match = re.search(r'http://127\.0\.0\.1:\d+', line)
    assert match, line + process.stdout.read()
    return process, match.group()

def stop(process):
    process.terminate()
    process.wait(timeout=10)

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(base, opener, path, data=None, status=200):
    request = urllib.request.Request(base + '/api' + path, data=urllib.parse.urlencode(data).encode() if data is not None else None)
    try:
        with opener.open(request, timeout=20) as response:
            actual, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        actual, result = error.code, json.load(error)
    check(actual == status, f'{path}: expected {status}, got {actual}: {result}')
    return result

def login(base, username, password):
    opener = client()
    call(base, opener, '/session', dict(username=username, password=password))
    return opener

try:
    with tempfile.TemporaryDirectory(prefix='itsm-storage-') as directory:
        database = Path(directory) / 'integration.sqlite'
        sample = root / 'database/sample.sqlite'
        original_sample = hashlib.sha256(sample.read_bytes()).digest()
        shutil.copy2(sample, database)
        process, base = start(database)
        admin = login(base, 'admin', 'admin123')
        seed_employee = login(base, 'employee', 'emp123')
        tech = login(base, 'tech1', 'tech123')
        login(base, 'tech2', 'tech123')
        # The distributable sample is intentionally empty; create historical test data here only.
        if not call(base, admin, '/incidents')['incidents']:
            seed = call(base, seed_employee, '/incidents', dict(title='Temporary historical fixture', description='Created only in the disposable test database.', category='NETWORK', impact=3, urgency=3, businessCriticality=3), status=201)
            seed_path = '/incidents/' + seed['incidentId']
            call(base, admin, seed_path + '/assign', {'strategy': 'SKILL'})
            call(base, tech, seed_path + '/acknowledge', {})
            call(base, tech, seed_path + '/start', {})
            call(base, tech, seed_path + '/resolve', {'notes': 'Temporary fixture resolved.'})
            call(base, seed_employee, seed_path + '/verify', {})
            call(base, seed_employee, seed_path + '/close', {})
        existing = call(base, admin, '/incidents')
        check(existing['storage'] == 'SQLITE', 'Storage status is truthful')
        check(any(i['incidentId'] == 'INC0001' and i['status'] == 'CLOSED' for i in existing['incidents']), 'Supplied sample restored without replacing latest backend')
        original_ticket = call(base, admin, '/incidents/INC0001')
        check(len(original_ticket['history']) == 7, 'Imported audit history preserved')
        anonymous = client()
        check(call(base, anonymous, '/capabilities')['registration'], 'Registration enabled with persistent store')
        registration = dict(name='Storage Test Employee', username='storage.test', password='initial-test-password', email='storage@itsm.local', department='IT', role='ADMINISTRATOR', active='true', approvalPending='false')
        for fields in [dict(registration, password='short'), dict(registration, department='  '), dict(registration, email='invalid')]:
            call(base, anonymous, '/register', fields, status=400)
        registered = call(base, anonymous, '/register', registration, status=201)
        check(registered['userId'] == 'E006', 'Registration ID respects sample account IDs')
        call(base, anonymous, '/register', dict(registration, username='STORAGE.TEST'), status=409)
        check(registered['approvalPending'], 'Registration cannot bypass administrator approval')
        approval_path = '/users/' + registered['userId'] + '/approve'
        call(base, anonymous, '/session', dict(username=registration['username'], password='wrong'), status=401)
        check('approval' in call(base, anonymous, '/session', dict(username=registration['username'], password=registration['password']), status=403)['error'], 'Pending login explains approval requirement')
        call(base, anonymous, approval_path, {}, status=401)
        call(base, seed_employee, approval_path, {}, status=403)
        call(base, tech, approval_path, {}, status=403)
        call(base, admin, '/users/' + registered['userId'] + '/active', {'active': 'true'}, status=409)
        stop(process)
        process, base = start(database)
        admin = login(base, 'admin', 'admin123')
        seed_employee = login(base, 'employee', 'emp123')
        tech = login(base, 'tech1', 'tech123')
        call(base, client(), '/session', dict(username=registration['username'], password=registration['password']), status=403)
        pending = next(u for u in call(base, admin, '/users')['users'] if u['userId'] == registered['userId'])
        check(pending['approvalPending'] and not pending['active'], 'Pending registration survives restart and appears in admin directory')
        approved = call(base, admin, approval_path, {})
        check(not approved['approvalPending'] and approved['active'], 'Only administrator approval enables access')
        call(base, admin, approval_path, {}, status=409)
        employee = login(base, registration['username'], registration['password'])
        profile = call(base, employee, '/session')
        check(profile['role'] == 'EMPLOYEE' and profile['active'], 'Registration cannot forge role or inactive flag')
        payload = dict(title='Persistent Wi-Fi issue ✓', description='Unicode and newlines\nSecond line, "quoted".', category='NETWORK', impact=3, urgency=3, businessCriticality=3)
        incident = call(base, employee, '/incidents', payload, status=201)
        path = '/incidents/' + incident['incidentId']
        check(incident['incidentId'] == 'INC0002', 'Incident ID follows existing sample')
        call(base, admin, path + '/assign', {'strategy': 'SKILL'})
        call(base, tech, path + '/acknowledge', {})
        call(base, tech, path + '/start', {})
        call(base, tech, path + '/request-information', {'question': 'Which device and error message? ✓'})
        call(base, employee, path + '/add-information', {'notes': 'Laptop, "No internet".\nIt happened twice.'})
        call(base, tech, path + '/resume', {})
        call(base, tech, path + '/request-information', {'question': 'Does Ethernet work?'})
        before = call(base, employee, path)
        notices = call(base, employee, '/incidents')['notifications']
        import base64
        # Real tiny JPEG fixture, generated once for API and persistence verification.
        picture = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDtqKKK5jE//9k='
        fields = dict(name='Updated Stored Employee', username='stored.employee', email='updated@itsm.local', department='Engineering', phone='+91 98765 43210', profilePicture=picture)
        call(base, employee, '/profile', dict(fields, phone='abc'), status=400)
        call(base, employee, '/profile', dict(fields, profilePicture='data:image/jpeg;base64,bad'), status=400)
        call(base, employee, '/profile', fields)
        call(base, employee, '/profile', {key: value for key, value in fields.items() if key not in ('phone', 'profilePicture')})
        call(base, employee, '/profile/password', dict(currentPassword=registration['password'], newPassword='persisted-test-password'))
        call(base, admin, '/technicians/T001/availability', {'available': 'false'})
        call(base, admin, '/technicians/T001/skills', {'skill': 'DATABASE'})
        call(base, admin, '/users/T002/active', {'active': 'false'})
        stop(process)
        process, base = start(database)
        admin = login(base, 'admin', 'admin123')
        tech = login(base, 'tech1', 'tech123')
        employee = login(base, 'stored.employee', 'persisted-test-password')
        call(base, client(), '/session', dict(username='storage.test', password=registration['password']), status=401)
        call(base, client(), '/session', dict(username='tech2', password='tech123'), status=401)
        after = call(base, employee, path)
        check(after == before, 'Exact incident content, status, history, deadlines, question/reply timestamps survive restart')
        check(call(base, employee, '/incidents')['notifications'] == notices, 'Notification identity/text/order survive restart')
        restored_profile = call(base, employee, '/session')
        check(restored_profile['department'] == 'Engineering', 'Profile saved')
        check(restored_profile['phone'] == fields['phone'] and restored_profile['profilePicture'] == picture, 'Phone and picture survive omitted fields and server restart')
        technician = call(base, admin, '/technicians/T001')
        check(not technician['available'] and 'DATABASE' in technician['skills'] and technician['activeIncidentCount'] == 1, 'Skills, availability and derived workload survive restart')
        check(call(base, admin, '/incidents/INC0001') == original_ticket, 'Imported historical ticket remains unchanged')
        call(base, employee, path + '/add-information', {'notes': 'Ethernet works.'})
        call(base, tech, path + '/resume', {})
        call(base, tech, path + '/resolve', {'notes': 'Updated wireless driver and verified stable connectivity.'})
        call(base, employee, path + '/verify', {})
        closed = call(base, employee, path + '/close', {})
        check(call(base, admin, '/technicians/T001')['activeIncidentCount'] == 0, 'Closure releases restored workload')
        call(base, admin, '/users/T002/active', {'active': 'true'})
        check(call(base, admin, '/technicians/T002')['available'], 'Activation restores stored availability preference')
        stop(process)
        process, base = start(database)
        admin = login(base, 'admin', 'admin123')
        employee = login(base, 'stored.employee', 'persisted-test-password')
        check(call(base, employee, path) == closed, 'Completed lifecycle persists through another restart')
        db = sqlite3.connect(database)
        check(db.execute('PRAGMA foreign_key_check').fetchall() == [], 'Foreign keys remain valid')
        check(db.execute('SELECT count(*) FROM information_requests').fetchone()[0] == 2, 'Both question rounds in SQLite')
        check(db.execute('SELECT count(*) FROM information_replies').fetchone()[0] == 2, 'Both replies in SQLite')
        stored_hash = db.execute('SELECT password_hash FROM accounts WHERE username=?', ('stored.employee',)).fetchone()[0]
        check(stored_hash.startswith('pbkdf2-sha256$') and 'persisted-test-password' not in stored_hash, 'Passwords stored as salted hashes')
        count_before = len(call(base, employee, '/incidents')['incidents'])
        db.execute('BEGIN IMMEDIATE')
        call(base, employee, '/incidents', dict(payload, title='Must not be committed'), status=503)
        db.rollback()
        check(len(call(base, employee, '/incidents')['incidents']) == count_before, 'Failed database transaction rolls back in-memory state')
        check(db.execute('SELECT count(*) FROM incidents WHERE title=?', ('Must not be committed',)).fetchone()[0] == 0, 'Failed write absent from database')
        db.close()
        second, second_base = start(database)
        other = login(second_base, 'stored.employee', 'persisted-test-password')
        created = call(base, employee, '/incidents', dict(payload, title='Committed by first process'), status=201)
        call(second_base, other, '/incidents', dict(payload, title='Stale writer must not overwrite'), status=409)
        call(second_base, other, '/session', status=401)
        other = login(second_base, 'stored.employee', 'persisted-test-password')
        all_rows = call(second_base, other, '/incidents')['incidents']
        check(any(row['incidentId'] == created['incidentId'] for row in all_rows), 'Conflict reloads latest committed data')
        check(all(row['title'] != 'Stale writer must not overwrite' for row in all_rows), 'Revision guard prevents lost updates')
        stop(second)
        active_path = '/incidents/' + created['incidentId']
        assigned = call(base, admin, active_path + '/assign', {'strategy': 'LOAD'})
        call(base, admin, '/technicians/T001/availability', {'available': 'true'})
        transferred = call(base, admin, active_path + '/reassign', dict(technicianId='T001', expectedTechnicianId=assigned['technicianId'], expectedStatus='ASSIGNED'))
        check(transferred['technicianId'] == 'T001' and transferred['history'][-1]['action'] == 'REASSIGN', 'Reassignment committed with audit')
        stop(process)
        process, base = start(database)
        tech = login(base, 'tech1', 'tech123')
        restored_transfer = call(base, tech, active_path)
        check(restored_transfer == {**transferred, 'actions': ['acknowledge']}, 'Reassignment, audit and new-owner access survive restart')
        check(hashlib.sha256(sample.read_bytes()).digest() == original_sample, 'Supplied sample file is untouched')
        print(f'PASS: {checks} SQLite, migration, registration, restart, rollback and conflict assertions.')
finally:
    for process in processes:
        if process.poll() is None:
            stop(process)
