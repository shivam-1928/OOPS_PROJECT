const assert = require('node:assert/strict');
const { selectIncidents, summarize, pendingDeadline } = require('../frontend/sla.js');
const row = (id, extra = {}) => ({ incidentId: id, title: 'Office network', priority: 'P3', status: 'CLASSIFIED', slaStatus: 'WITHIN SLA', technicianId: null, responseDeadline: '2026-11-20T10:00:00', resolutionDeadline: '2026-11-20T12:00:00', acknowledgedAt: null, ...extra });
const rows = [
  row('INC0010'),
  row('INC0002', { slaStatus: 'AT RISK', technicianId: 'T001' }),
  row('INC0004', { slaStatus: 'RESOLUTION SLA BREACHED', acknowledgedAt: '2026-11-20T09:00:00', resolutionDeadline: '2026-11-20T09:30:00' }),
  row('INC0001', { priority: 'P1', slaStatus: 'RESPONSE SLA BREACHED', responseDeadline: '2026-11-20T09:00:00' }),
  row('INC0003', { status: 'RESOLVED', resolvedAt: '2026-11-20T08:00:00' }),
  row('INC0005', { status: 'VERIFIED' }),
  row('INC0006', { status: 'CLOSED' }),
];
assert.deepEqual(summarize(rows), { active: 4, within: 1, risk: 1, breached: 2 });
assert.deepEqual(selectIncidents(rows).map(r => r.incidentId), ['INC0001', 'INC0004', 'INC0002', 'INC0010']);
assert.equal(selectIncidents(rows, { scope: 'completed' }).length, 3);
assert.equal(selectIncidents(rows, { scope: 'all' }).length, 7);
assert.deepEqual(selectIncidents(rows, { scope: 'all', slaStatus: 'BREACHED' }).map(r => r.incidentId), ['INC0001', 'INC0004']);
assert.deepEqual(selectIncidents(rows, { slaStatus: 'AT RISK', priority: 'P3', technicianId: 'T001' }, 'network').map(r => r.incidentId), ['INC0002']);
assert.equal(selectIncidents(rows, { priority: 'P1', technicianId: 'T001' }).length, 0);
assert.equal(selectIncidents(rows, { technicianId: 'UNASSIGNED' }).length, 3);
assert.equal(selectIncidents(rows, {}, 'no matching title').length, 0);
assert.equal(selectIncidents(rows, {}, 'inc0010')[0].incidentId, 'INC0010');
assert.deepEqual(selectIncidents(rows, {}, '', 'id').map(r => r.incidentId), ['INC0001', 'INC0002', 'INC0004', 'INC0010']);
assert.equal(pendingDeadline(rows[2]), Date.parse('2026-11-20T09:30:00'));
assert.equal(pendingDeadline(rows[4]), Infinity);
assert.equal(selectIncidents(rows, {}, '', 'deadline')[0].incidentId, 'INC0001');
assert.equal(selectIncidents(rows, {}, '', 'priority')[0].priority, 'P1');
assert.equal(rows[0].incidentId, 'INC0010', 'View sorting must not mutate the fetched snapshot');
assert.equal(selectIncidents([row('INC1'), row('INC2')], {}, '', 'id')[0].incidentId, 'INC1');
console.log('PASS: 17 SLA view assertions.');
