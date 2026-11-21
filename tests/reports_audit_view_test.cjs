const assert = require('node:assert/strict');
const { validRange, filterIncidents, summary, filterHistory, collectHistory, csv } = require('../frontend/reports-audit.js');
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const statuses = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_FOR_EMPLOYEE', 'RESOLVED', 'VERIFIED', 'CLOSED', 'ESCALATED'];
const rows = statuses.map((status, i) => ({ incidentId: `INC${i + 1}`, title: `Issue ${i + 1}`, status, category: i % 2 ? 'NETWORK' : 'EMAIL', priority: `P${i % 4 + 1}`, createdAt: `2026-11-${i % 2 ? '20' : '19'}T12:00:00` }));
check(summary(rows), { total: 10, open: 7, resolved: 2, closed: 1, critical: 3 });
check(summary([]), { total: 0, open: 0, resolved: 0, closed: 0, critical: 0 });
check(validRange({ from: '2026-11-20', through: '2026-11-19' }), false);
check(validRange({ from: '2026-11-20', through: '2026-11-20' }), true);
check(validRange({ through: '2026-11-20' }), true);
check(filterIncidents(rows, { from: '2026-11-20', through: '2026-11-20' }).length, 5);
check(filterIncidents(rows, { through: '2026-11-19' }).length, 5);
check(filterIncidents(rows, { from: '2026-11-21' }).length, 0);
check(filterIncidents(rows, { from: '2026-11-20', category: 'NETWORK', priority: 'P2' }).map(r => r.incidentId), ['INC2', 'INC6', 'INC10']);
check(filterIncidents(rows, { from: '2026-11-20', through: '2026-11-19' }), []);
const logs = [
  { timestamp: '2026-11-19T10:00:00', action: 'CREATE_INCIDENT', userId: 'E001', incidentId: 'INC1', title: 'Wireless unavailable', previousState: 'NONE', newState: 'CLASSIFIED', description: 'Incident reported.', entryIndex: 0 },
  { timestamp: '2026-11-20T11:00:00.000001', action: 'START', userId: 'T001', incidentId: 'INC1', title: 'Wireless unavailable', previousState: 'ACKNOWLEDGED', newState: 'IN_PROGRESS', description: 'Investigation started.', entryIndex: 1 },
  { timestamp: '2026-11-20T11:00:00.000001', action: 'RESOLVE', userId: 'T001', incidentId: 'INC1', title: 'Wireless unavailable', previousState: 'IN_PROGRESS', newState: 'RESOLVED', description: 'Reset "wireless", checked connection.\nVerified.', entryIndex: 2 }
];
check(filterHistory(logs).map(r => r.action), ['RESOLVE', 'START', 'CREATE_INCIDENT']);
check(filterHistory(logs, {}, '', 'oldest').map(r => r.action), ['CREATE_INCIDENT', 'START', 'RESOLVE']);
check(filterHistory(logs, { userId: 'T001', action: 'RESOLVE', from: '2026-11-20', through: '2026-11-20' }, 'wireless').length, 1);
check(filterHistory(logs, {}, 'create incident').length, 1);
check(filterHistory(logs, { action: 'CREATE_INCIDENT', userId: 'T001' }).length, 0);
check(filterHistory(logs, { from: '2026-11-21', through: '2026-11-20' }), []);
check(logs[0].action, 'CREATE_INCIDENT');
check(csv([['a,b', '"quoted"', 'line\nbreak', null]]), '"a,b","""quoted""","line\nbreak",""');
check(csv([['=1+1', ' +SUM(A1)', '-1+2', '@SUM(A1)', '\t=SUM(A1)']]), '"\'=1+1","\' +SUM(A1)","\'-1+2","\'@SUM(A1)","\'\t=SUM(A1)"');
check(csv([['Incident', 'Total'], ['INC1', 3]]), '"Incident","Total"\r\n"INC1","3"');
(async () => {
  let active = 0, peak = 0;
  const result = await collectHistory(rows, async id => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return { history: [{ timestamp: '2026-11-20T12:00:00', userId: 'E001', action: 'CREATE_INCIDENT', description: id }] };
  });
  check(result.length, 10);
  check(peak, 4);
  check(new Set(result.map(log => log.incidentId)).size, 10);
  check(result.find(log => log.incidentId === 'INC10').title, 'Issue 10');
  check(result.every(log => log.entryIndex === 0), true);
  let reads = 0;
  check(await collectHistory(rows, async () => { reads++; return { history: [] }; }, () => false), []);
  check(reads, 0);
  await assert.rejects(collectHistory(rows, async () => { throw new Error('Network failure'); }), /Network failure/); checks++;
  await assert.rejects(collectHistory(rows, async () => ({})), /incomplete incident history/); checks++;
  check(await collectHistory([], async () => { throw new Error('Should not fetch'); }), []);
  console.log(`PASS: ${checks} report, audit, batching and CSV assertions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
