const assert = require('node:assert/strict');
const { attentionReason, buildView, buildAnalytics } = require('../frontend/overview.js');
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const row = (id, status, actions = [], extra = {}) => ({ incidentId: id, title: id, status, actions, priority: 'P3', createdAt: '2026-11-21T10:00:00', slaStatus: 'WITHIN SLA', ...extra });
check(attentionReason(row('1', 'WAITING_FOR_EMPLOYEE', ['add-information']), 'EMPLOYEE'), 'Provide requested information');
check(attentionReason(row('1', 'WAITING_FOR_EMPLOYEE'), 'EMPLOYEE'), null);
check(attentionReason(row('1', 'RESOLVED', ['verify']), 'EMPLOYEE'), 'Verify the resolution');
check(attentionReason(row('1', 'VERIFIED', ['close']), 'EMPLOYEE'), 'Close the verified ticket');
check(attentionReason(row('1', 'ASSIGNED', ['acknowledge']), 'TECHNICIAN'), 'Acknowledge assignment');
check(attentionReason(row('1', 'ACKNOWLEDGED', ['start']), 'TECHNICIAN'), 'Start investigation');
check(attentionReason(row('1', 'WAITING_FOR_EMPLOYEE', ['resume']), 'TECHNICIAN'), 'Review employee information and resume');
check(attentionReason(row('1', 'ESCALATED', []), 'TECHNICIAN'), null);
check(attentionReason(row('1', 'CLASSIFIED', ['assign']), 'ADMINISTRATOR'), 'Assign a technician');
check(attentionReason(row('1', 'CLASSIFIED', ['assign']), 'EMPLOYEE'), null);
check(attentionReason(row('1', 'IN_PROGRESS', ['resolve']), 'TECHNICIAN'), null);
const rows = [row('INC1', 'CLASSIFIED'), row('INC2', 'WAITING_FOR_EMPLOYEE', ['add-information']), row('INC3', 'RESOLVED', ['verify'], { slaStatus: 'RESPONSE SLA BREACHED' }), row('INC4', 'VERIFIED', ['close']), row('INC5', 'CLOSED')];
const frozen = JSON.stringify(rows);
const view = buildView(rows, [], 'EMPLOYEE');
check(view.open, 2); check(view.completed, 3); check(view.attention.length, 3);
check(view.warnings.length, 0); check(JSON.stringify(rows), frozen);
const warnings = [row('INC10', 'IN_PROGRESS', [], { slaStatus: 'AT RISK', priority: 'P1' }), row('INC2', 'CLASSIFIED', [], { slaStatus: 'RESPONSE SLA BREACHED', priority: 'P2' }), row('INC3', 'ASSIGNED', [], { slaStatus: 'RESOLUTION SLA BREACHED', priority: 'P1' })];
check(buildView(warnings, [], 'ADMINISTRATOR').warnings.map(r => r.incidentId), ['INC3', 'INC2', 'INC10']);
const logs = Array.from({ length: 12 }, (_, i) => ({ incidentId: 'INC1', timestamp: '2026-11-21T12:00:00', entryIndex: i }));
check(buildView(rows, logs, 'EMPLOYEE').activity.map(l => l.entryIndex), [11, 10, 9, 8, 7, 6, 5, 4]);
check(buildView(rows, logs, 'EMPLOYEE').recent.incidentId, 'INC1');
check(buildView([rows[0], { ...rows[1], createdAt: '2026-11-21T15:00:00' }], [], 'EMPLOYEE').recent.incidentId, 'INC2');
check(buildView([], [], 'EMPLOYEE').recent, null);
check(buildView([], [], 'EMPLOYEE').attention, []);
check(buildView(rows, [{ incidentId: 'INC3', timestamp: '2026-11-22', entryIndex: 0 }, ...logs], 'EMPLOYEE').recent.incidentId, 'INC3');
check(buildView(warnings, [], 'TECHNICIAN').attention.length, 0);
check(buildView([row('INC10', 'CLASSIFIED', ['assign']), row('INC2', 'CLASSIFIED', ['assign'], { priority: 'P1' })], [], 'ADMINISTRATOR').attention.map(r => r.incidentId), ['INC2', 'INC10']);
console.log(`Overview: ${checks} assertions passed.`);

const analyticsRows = [
 { category: 'NETWORK', createdAt: '2026-11-22T09:00:00' },
 { category: 'NETWORK', createdAt: '2026-11-22T10:00:00' },
 { category: 'HARDWARE', createdAt: '2026-11-21T23:59:00' },
 { category: 'NETWORK', createdAt: '2026-10-23T12:00:00' },
 { category: 'EMAIL', createdAt: '2026-11-23T12:00:00' }
];
const analytics = buildAnalytics(analyticsRows, '', new Date(2026, 10, 22, 12));
check(analytics.values.length, 30);
check(analytics.values.slice(-2), [1, 2]);
check(analytics.values.reduce((a,b) => a+b, 0), 3);
check(analytics.counts.find(row => row.category === 'NETWORK').count, 3);
check(buildAnalytics(analyticsRows, 'HARDWARE', new Date(2026,10,22,12)).values.reduce((a,b)=>a+b,0), 1);
check(buildAnalytics([], '', new Date(2026,10,22)).values, Array(30).fill(0));
console.log('Analytics: 6 date-window, category and empty-data assertions passed.');
