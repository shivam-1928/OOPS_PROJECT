"""Integration checks against an isolated Java server with disposable in-memory data.
Run after compiling: python tests/web_api_test.py --java PATH_TO_JAVA
"""
import argparse
import http.cookiejar
import itertools
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--java', default='java')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
server = subprocess.Popen([args.java, '-cp', '.build/classes', 'itsm.web.WebServer', '0'], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
checks = 0

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

try:
    startup = server.stdout.readline()
    match = re.search(r'http://127\.0\.0\.1:\d+', startup)
    assert match, startup
    base = match.group()
    def client():
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def call(opener, path, data=None, status=200, headers=None):
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        req = urllib.request.Request(base + '/api' + path, data=body, headers=headers or {})
        try:
            with opener.open(req, timeout=8) as response:
                actual, result = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            actual, result = error.code, json.load(error)
        check(actual == status, f'{path}: expected {status}, got {actual}: {result}')
        return result
    anonymous, employee, admin, tech1, tech2 = [client() for _ in range(5)]
    call(anonymous, '/incidents', status=401)
    call(anonymous, '/session', {'username': 'employee', 'password': 'wrong'}, status=401)
    for c, name, password, role in [(employee,'employee','emp123','EMPLOYEE'),(admin,'admin','admin123','ADMINISTRATOR'),(tech1,'tech1','tech123','TECHNICIAN'),(tech2,'tech2','tech123','TECHNICIAN')]:
        result = call(c, '/session', {'username':name,'password':password})
        check(result['role'] == role and 'password' not in result, 'Safe session response')
    call(anonymous, '/profile', {'name': 'Blocked'}, status=401)
    call(employee, '/users', status=403)
    call(tech1, '/users', status=403)
    directory = call(admin, '/users')['users']
    check(len(directory) == 4 and all('username' in u and 'email' in u and 'active' in u and 'password' not in u for u in directory), 'Admin gets safe complete user directory')
    check(next(u for u in directory if u['userId'] == 'A001')['deactivationReason'], 'Self-deactivation explained')
    original_profile = call(employee, '/session')
    check(original_profile['department'] == 'General' and original_profile['email'], 'Self profile exposes employee fields')
    for invalid in [{**original_profile, 'username': 'ADMIN'}, {**original_profile, 'email': 'invalid'}, {**original_profile, 'department': ' '}, {**original_profile, 'username': 'invalid username'}, {**original_profile, 'name': 'x' * 121}]:
        call(employee, '/profile', invalid, status=409 if invalid['username'] == 'ADMIN' else 400)
    check(call(employee, '/session') == original_profile, 'Invalid profile updates are atomic')
    updated = call(employee, '/profile', {**original_profile, 'name': '  Updated Employee ✓  ', 'username': 'employee.updated', 'email': 'updated@itsm.local', 'department': 'Support', 'role': 'ADMINISTRATOR', 'active': 'false', 'userId': 'A001'})
    check(updated['name'] == 'Updated Employee ✓' and updated['role'] == 'EMPLOYEE' and updated['userId'] == 'E001' and updated['active'], 'Profile edits cannot change identity, role or account status')
    relogin = client()
    call(relogin, '/session', {'username': 'employee', 'password': 'emp123'}, status=401)
    call(relogin, '/session', {'username': 'employee.updated', 'password': 'emp123'})
    call(employee, '/profile/password', {'currentPassword': 'wrong', 'newPassword': 'updated-password'}, status=400)
    call(employee, '/profile/password', {'currentPassword': 'emp123', 'newPassword': 'short'}, status=400)
    call(employee, '/profile/password', {'currentPassword': 'emp123', 'newPassword': 'updated-password'})
    call(relogin, '/session', status=401)
    call(relogin, '/session', {'username': 'employee.updated', 'password': 'emp123'}, status=401)
    call(relogin, '/session', {'username': 'employee.updated', 'password': 'updated-password'})
    call(employee, '/profile', original_profile)
    call(admin, '/users/A001/active', {'active': 'false'}, status=409)
    call(employee, '/users/T002/active', {'active': 'false'}, status=403)
    call(tech1, '/users/T002/active', {'active': 'false'}, status=403)
    call(admin, '/users/T002/active', {'active': 'maybe'}, status=400)
    call(admin, '/users/UNKNOWN/active', {'active': 'false'}, status=404)
    disabled = call(admin, '/users/T002/active', {'active': 'false'})
    check(not disabled['active'], 'Admin can deactivate an idle account')
    call(tech2, '/session', status=401)
    call(tech2, '/session', {'username': 'tech2', 'password': 'tech123'}, status=401)
    check(not next(t for t in call(admin, '/technicians')['technicians'] if t['userId'] == 'T002')['available'], 'Inactive technician unavailable for assignment')
    call(admin, '/users/T002/active', {'active': 'true'})
    call(tech2, '/session', status=401)
    call(tech2, '/session', {'username': 'tech2', 'password': 'tech123'})
    for page in ['/signin.html', '/signup.html']:
        with anonymous.open(base + page) as response:
            check(response.status == 200 and b'auth-page' in response.read(), 'Standalone authentication document')
    call(anonymous, '/register', {'username': 'not-created'}, status=503)
    for factors in itertools.product(range(1, 6), repeat=3):
        score = factors[0]*factors[1]*factors[2]
        expected = 'P1' if score >= 75 else 'P2' if score >= 40 else 'P3' if score >= 15 else 'P4'
        result = call(employee, '/priority', dict(zip(['impact','urgency','businessCriticality'], factors)))
        check(result['priority'] == expected, f'Priority score {score}')
    payload = dict(title='Payment unavailable <script>alert(1)</script> ✓', description='Payment transactions fail for all office employees.', category='NETWORK', impact=5, urgency=5, businessCriticality=5)
    call(admin, '/incidents', payload, status=403)
    call(employee, '/incidents', {**payload,'impact':0}, status=400)
    call(employee, '/incidents', {**payload,'title':'  '}, status=400)
    call(employee, '/incidents', {**payload,'category':'CLOUD'}, status=400)
    incident = call(employee, '/incidents', payload, status=201)
    ident = incident['incidentId']; path = '/incidents/' + ident
    check(incident['status'] == 'CLASSIFIED' and incident['priority'] == 'P1', 'Classification and priority')
    check(incident['title'] == payload['title'], 'JSON escapes and Unicode round trip')
    from datetime import datetime
    check((datetime.fromisoformat(incident['responseDeadline'])-datetime.fromisoformat(incident['createdAt'])).total_seconds() == 300, 'P1 response deadline')
    check((datetime.fromisoformat(incident['resolutionDeadline'])-datetime.fromisoformat(incident['createdAt'])).total_seconds() == 1800, 'P1 resolution deadline')
    duplicate = call(employee, '/incidents', payload, status=201)
    check(duplicate['duplicates'][0]['incidentId'] == ident, 'Duplicate suggestion')
    call(tech2, path, status=403)
    call(employee, path + '/verify', {}, status=403)
    call(employee, path + '/assign', {'strategy':'SKILL'}, status=403)
    call(admin, path + '/assign', {'strategy':'UNKNOWN'}, status=400)
    incident = call(admin, path + '/assign', {'strategy':'SKILL'})
    check(incident['technicianId'] == 'T001' and incident['status'] == 'ASSIGNED', 'Skill assignment')
    check(incident['history'][-1]['previousState'] == 'CLASSIFIED', 'Audit captures pre-assignment state')
    assignment_people = call(admin, '/incidents')['users']
    check(next(user for user in assignment_people if user['userId'] == incident['technicianId'])['username'] == 'tech1', 'Admin can identify assigned technician by current username and ID')
    call(admin, path + '/assign', {'strategy':'LOAD'}, status=403)
    call(tech1, path + '/resolve', {'notes':'not yet'}, status=403)
    call(tech2, path + '/acknowledge', {}, status=403)
    technician_snapshot = call(tech1, '/incidents')
    check(len(technician_snapshot['incidents']) == 1, 'Technician scoped list')
    check(len({u['userId'] for u in technician_snapshot['users']}) == len(technician_snapshot['users']), 'No duplicate technician options')
    incident = call(tech1, path + '/acknowledge', {})
    check(incident['acknowledgedAt'] is not None, 'Acknowledgement timestamp')
    call(tech1, path + '/start', {})
    for invalid_question in [{}, {'question': '   '}, {'question': 'x' * 2001}]:
        call(tech1, path + '/request-information', invalid_question, status=400)
    unchanged = call(tech1, path)
    check(unchanged['status'] == 'IN_PROGRESS' and unchanged['informationRequests'] == [], 'Invalid questions leave status and requests unchanged')
    question = 'Does the Wi-Fi fail on a second laptop? <script>test</script> ✓'
    call(employee, path + '/request-information', {'question': question}, status=403)
    call(tech2, path + '/request-information', {'question': question}, status=403)
    incident = call(tech1, path + '/request-information', {'question': '  ' + question + '  '})
    check(incident['informationRequests'][0]['question'] == question, 'Specific question is trimmed and preserved as text')
    check(incident['informationRequests'][0]['technicianId'] == 'T001' and incident['informationRequests'][0]['askedAt'], 'Question records authenticated technician and timestamp')
    check(question in incident['history'][-1]['description'], 'Audit retains question')
    check(question in call(employee, '/incidents')['notifications'][-1], 'Employee notification contains question')
    check(call(employee, path)['informationRequests'][0]['question'] == question, 'Employee can read question')
    call(tech1, path + '/request-information', {'question': 'Another question'}, status=403)
    call(employee, path + '/add-information', {'notes': '   '}, status=400)
    incident = call(employee, path + '/add-information', {'notes':'Reproduces on a second laptop.'})
    check(incident['status'] == 'WAITING_FOR_EMPLOYEE' and 'second laptop' in incident['description'], 'Information does not bypass resume transition')
    reply = incident['informationRequests'][0]['replies'][0]
    check(reply['employeeId'] == 'E001' and reply['text'] == 'Reproduces on a second laptop.' and reply['timestamp'], 'Reply linked to question with author and timestamp')
    check('Reproduces on a second laptop.' in call(tech1, '/incidents')['notifications'][-1], 'Technician notified of response')
    call(tech1, path + '/resume', {})
    call(tech1, path + '/request-information', {'question': 'What error code appears?'})
    incident = call(employee, path + '/add-information', {'notes': 'Error 504.'})
    check(len(incident['informationRequests']) == 2 and incident['informationRequests'][0]['replies'][0]['text'] == reply['text'], 'Further request preserves first exchange')
    check(incident['informationRequests'][1]['replies'][0]['text'] == 'Error 504.', 'New reply belongs to latest question')
    call(tech1, path + '/resume', {})
    call(tech1, path + '/resolve', {'notes':'  '}, status=400)
    incident = call(tech1, path + '/resolve', {'notes':'Reconfigured access point.'})
    check(incident['status'] == 'RESOLVED' and incident['resolvedAt'] is not None, 'Resolution saved')
    call(employee, path + '/close', {}, status=403)
    call(employee, path + '/verify', {})
    incident = call(employee, path + '/close', {})
    check(incident['status'] == 'CLOSED' and incident['closedAt'] is not None, 'Verified closure')
    check(len(incident['history']) == 13, 'Full workflow history includes both information exchanges')
    snapshot = call(admin, '/incidents')
    check(next(u for u in snapshot['users'] if u['userId'] == 'T001')['activeIncidentCount'] == 0, 'Workload released on closure')
    check(len(call(employee, '/incidents')['notifications']) >= 6, 'Employee notifications generated')
    query = urllib.parse.urlencode(dict(category='NETWORK',priority='P1',status='CLOSED',employeeId='E001',technicianId='T001'))
    check(len(call(admin, '/incidents?' + query)['incidents']) == 1, 'All five filters combine; unassigned incidents do not crash')
    check(len(call(admin, '/incidents?technicianId=T002')['incidents']) == 0, 'No-match filter')
    load = call(admin, '/incidents/' + duplicate['incidentId'] + '/assign', {'strategy':'LOAD'})
    check(load['technicianId'] == 'T001', 'Load-based tie follows backend iteration order')
    other = call(employee, '/incidents', {**payload,'category':'OTHER','title':'Unsupported category skills'}, status=201)
    call(admin, '/incidents/' + other['incidentId'] + '/assign', {'strategy':'SKILL'}, status=409)
    check(call(admin, '/incidents/' + other['incidentId'])['status'] == 'CLASSIFIED', 'Failed assignment is atomic')
    load = call(admin, '/incidents/' + other['incidentId'] + '/assign', {'strategy':'LOAD'})
    check(load['technicianId'] == 'T002', 'Load-based selects lighter workload without matching skill')
    call(employee, '/escalate', {}, status=403)
    check(call(admin, '/escalate', {})['count'] == 0, 'No early SLA escalation')
    call(admin, '/escalate', {}, headers={'Origin':'https://example.com'}, status=403)
    call(admin, '/incidents/DOES_NOT_EXIST', status=404)
    # Technician directory, server permissions, and effects on real assignment strategies.
    call(anonymous, '/technicians', status=401)
    directory = call(admin, '/technicians')
    check(len(directory['technicians']) == 2 and directory['canManage'], 'Admin technician directory')
    check(all('password' not in row and 'username' not in row for row in directory['technicians']), 'Directory excludes credentials')
    check(not call(employee, '/technicians')['canManage'], 'Employee directory is read-only')
    check(not call(tech1, '/technicians')['canManage'], 'Technician directory is read-only')
    call(admin, '/technicians/UNKNOWN', status=404)
    call(employee, '/technicians/T001/availability', {'available':'false'}, status=403)
    call(tech1, '/technicians/T001/availability', {'available':'false'}, status=403)
    call(employee, '/technicians/T001/skills', {'skill':'DATABASE'}, status=403)
    call(tech2, '/technicians/T002/skills', {'skill':'DATABASE'}, status=403)
    own = call(tech1, '/technicians/T001')
    check(own['allAssignmentsVisible'] and not own['canManage'], 'Technician sees own full queue without management controls')
    check(all(i['technicianId'] == 'T001' for i in own['incidents']), 'Detail queue belongs to technician')
    other_detail = call(tech1, '/technicians/T002')
    check(not other_detail['allAssignmentsVisible'] and other_detail['incidents'] == [], 'Other technician assignments remain private')
    employee_detail = call(employee, '/technicians/T001')
    check(not employee_detail['allAssignmentsVisible'] and all(i['employeeId'] == 'E001' for i in employee_detail['incidents']), 'Employee sees only own reported assignments')
    before = call(admin, '/technicians/T001')
    call(admin, '/technicians/T001/availability', {'available':'maybe'}, status=400)
    check(call(admin, '/technicians/T001')['available'] == before['available'], 'Invalid availability cannot mutate model')
    paused = call(admin, '/technicians/T001/availability', {'available':'false','activeIncidentCount':'0'})
    check(not paused['available'] and paused['activeIncidentCount'] == before['activeIncidentCount'], 'Availability does not reset or accept a forged workload')
    check(len(paused['incidents']) == len(before['incidents']), 'Pausing leaves existing assignments intact')
    fresh = call(employee, '/incidents', {**payload,'title':'Technician availability check'}, status=201)
    fresh_path = '/incidents/' + fresh['incidentId']
    call(admin, fresh_path + '/assign', {'strategy':'SKILL'}, status=409)
    call(admin, '/technicians/T002/skills', {'skill':'  '}, status=400)
    added = call(admin, '/technicians/T002/skills', {'skill':' network '})
    check('NETWORK' in added['skills'], 'Skill normalized by existing Technician model')
    repeated = call(admin, '/technicians/T002/skills', {'skill':'NETWORK'})
    check(len(repeated['skills']) == len(added['skills']), 'Duplicate skill idempotent')
    assigned = call(admin, fresh_path + '/assign', {'strategy':'SKILL'})
    check(assigned['technicianId'] == 'T002', 'Skill updates and availability affect skill-based assignment')
    call(admin, '/technicians/T002/availability', {'available':'false'})
    blocked = call(employee, '/incidents', {**payload,'title':'No technicians available'}, status=201)
    blocked_path = '/incidents/' + blocked['incidentId']
    call(admin, blocked_path + '/assign', {'strategy':'LOAD'}, status=409)
    check(call(admin, blocked_path)['status'] == 'CLASSIFIED', 'No available technicians leaves incident unassigned')
    call(admin, '/technicians/T001/availability', {'available':'true'})
    assigned = call(admin, blocked_path + '/assign', {'strategy':'LOAD'})
    check(assigned['technicianId'] == 'T001', 'Restored availability used by load-based assignment')
    check(call(admin, '/technicians/T001')['activeIncidentCount'] == before['activeIncidentCount'] + 1, 'Technician directory reflects new workload')
    call(admin, '/technicians/T001/unknown', {}, status=404)
    call(admin, '/users/T001/active', {'active': 'false'}, status=409)
    call(admin, '/users/E001/active', {'active': 'false'}, status=409)
    check(call(tech1, '/session')['active'] and call(employee, '/session')['active'], 'Outstanding tickets block deactivation without losing sessions')
    # Manual reassignment is admin-only, guarded against stale confirmations and atomic.
    baseline = {t['userId']: t['activeIncidentCount'] for t in call(admin, '/technicians')['technicians']}
    manual = call(employee, '/incidents', {**payload, 'title': 'Manual reassignment test'}, status=201)
    manual_path = '/incidents/' + manual['incidentId']
    manual = call(admin, manual_path + '/assign', {'strategy': 'SKILL'})
    transfer = {'technicianId': 'T002', 'expectedTechnicianId': 'T001', 'expectedStatus': 'ASSIGNED'}
    for outsider in (employee, tech1, tech2):
        call(outsider, manual_path + '/reassign', transfer, status=403)
    call(admin, manual_path + '/reassign', {}, status=400)
    call(admin, manual_path + '/reassign', {**transfer, 'technicianId': 'T001'}, status=400)
    call(admin, manual_path + '/reassign', {**transfer, 'technicianId': 'UNKNOWN'}, status=400)
    call(admin, manual_path + '/reassign', transfer, status=409)
    check(call(admin, manual_path)['technicianId'] == 'T001', 'Unavailable destination leaves owner unchanged')
    call(admin, '/technicians/T002/availability', {'available': 'true'})
    call(tech1, manual_path + '/acknowledge', {})
    call(tech1, manual_path + '/start', {})
    call(tech1, manual_path + '/request-information', {'question': 'What changed before the outage?'})
    prior = call(employee, manual_path + '/add-information', {'notes': 'A driver update.'})
    call(admin, manual_path + '/reassign', transfer, status=409)
    changed = call(admin, manual_path + '/reassign', {**transfer, 'expectedStatus': 'WAITING_FOR_EMPLOYEE'})
    check(changed['status'] == 'ASSIGNED' and changed['technicianId'] == 'T002', 'Manual transfer returns ticket to assigned')
    check(changed['informationRequests'] == prior['informationRequests'] and changed['description'] == prior['description'], 'Transfer retains questions, replies and description')
    check(all(changed[key] == prior[key] for key in ('createdAt', 'acknowledgedAt', 'responseDeadline', 'resolutionDeadline')), 'Transfer retains timestamps and original SLA targets')
    check(changed['history'][-1]['action'] == 'REASSIGN' and changed['history'][-1]['previousState'] == 'WAITING_FOR_EMPLOYEE' and 'T001' in changed['history'][-1]['description'] and 'T002' in changed['history'][-1]['description'], 'Audit records old and new owner')
    workload = {t['userId']: t['activeIncidentCount'] for t in call(admin, '/technicians')['technicians']}
    check(workload['T001'] == baseline['T001'] and workload['T002'] == baseline['T002'] + 1, 'Workload moves once between technicians')
    check('reassigned from you' in call(tech1, '/incidents')['notifications'][-1], 'Old technician receives removal notification')
    check('reassigned to you' in call(tech2, '/incidents')['notifications'][-1], 'New technician notified')
    check('T002' in call(employee, '/incidents')['notifications'][-1], 'Employee notified of new owner')
    call(tech1, manual_path, status=403)
    call(tech1, manual_path + '/acknowledge', {}, status=403)
    check(call(tech2, manual_path)['actions'] == ['acknowledge'], 'New owner can acknowledge')
    call(admin, manual_path + '/reassign', transfer, status=409)
    after_ack = call(tech2, manual_path + '/acknowledge', {})
    check(after_ack['acknowledgedAt'] == prior['acknowledgedAt'], 'New owner acknowledgement preserves first response timestamp')
    call(tech2, manual_path + '/start', {})
    call(tech2, manual_path + '/resolve', {'notes': 'Fixed after handover.'})
    call(admin, manual_path + '/reassign', {**transfer, 'technicianId': 'T001', 'expectedTechnicianId': 'T002', 'expectedStatus': 'RESOLVED'}, status=403)
    call(employee, manual_path + '/verify', {})
    call(employee, manual_path + '/close', {})
    final_workload = {t['userId']: t['activeIncidentCount'] for t in call(admin, '/technicians')['technicians']}
    check(final_workload == baseline, 'Closing transferred ticket releases only its new owner workload')
    call(employee, '/logout', {})
    call(employee, '/session', status=401)
    with anonymous.open(base + '/') as response:
        check(response.status == 200 and b'incidents.js' in response.read(), 'Frontend served by Java')
    print(f'PASS: {checks} API and business-rule assertions on isolated server.')
finally:
    server.terminate()
    server.wait(timeout=10)
