(() => {
  'use strict';
  const completed = row => ['RESOLVED', 'VERIFIED', 'CLOSED'].includes(row.status);
  const actionLabels = { assign: 'Assign a technician', acknowledge: 'Acknowledge assignment', start: 'Start investigation', resume: 'Review employee information and resume', verify: 'Verify the resolution', close: 'Close the verified ticket' };
  function attentionReason(row, role) {
    if (role === 'EMPLOYEE' && row.status === 'WAITING_FOR_EMPLOYEE' && row.actions?.includes('add-information')) return 'Provide requested information';
    const eligible = role === 'EMPLOYEE' ? ['verify', 'close'] : role === 'TECHNICIAN' ? ['acknowledge', 'start', 'resume'] : role === 'ADMINISTRATOR' ? ['assign'] : [];
    const action = eligible.find(value => row.actions?.includes(value));
    return action ? actionLabels[action] : null;
  }
  const priorityOrder = (a, b) => a.priority.localeCompare(b.priority) || a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true });
  function buildView(rows, logs, role) {
    const attention = rows.map(row => ({ ...row, reason: attentionReason(row, role) })).filter(row => row.reason).sort(priorityOrder);
    const warnings = rows.filter(row => !completed(row) && ['AT RISK', 'RESPONSE SLA BREACHED', 'RESOLUTION SLA BREACHED'].includes(row.slaStatus))
      .sort((a, b) => Number(a.slaStatus === 'AT RISK') - Number(b.slaStatus === 'AT RISK') || priorityOrder(a, b));
    const activity = logs.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.incidentId.localeCompare(a.incidentId, undefined, { numeric: true }) || b.entryIndex - a.entryIndex);
    const fallback = rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || priorityOrder(a, b))[0];
    return { open: rows.filter(row => !completed(row)).length, completed: rows.filter(completed).length, attention, warnings,
      activity: activity.slice(0, 8), recent: rows.find(row => row.incidentId === activity[0]?.incidentId) || fallback || null };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { attentionReason, buildView };
  if (typeof document === 'undefined') return;

  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = value => String(value || '—').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bsla\b/g, 'SLA');
  const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const state = { user: window.ITSMCurrentUser || null, section: 'Incidents', rows: [], logs: [], profile: null, version: 0, loading: false, updated: null, controller: null, recent: null };
  const active = () => state.user && state.section === 'Overview';
  function controls() {
    $('#refresh-overview').disabled = !state.user || state.loading;
    $('#overview-incidents').disabled = !state.user;
    $('#overview-create').hidden = state.user?.role !== 'EMPLOYEE';
    $('#overview-create').disabled = state.loading;
    $('#overview-workspace').setAttribute('aria-busy', String(state.loading));
  }
  function renderProfile() {
    const user = state.user ? { ...state.user, ...state.profile } : null;
    const field = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
    if (!user) { $('#overview-profile').innerHTML = '<h2 id="overview-profile-title">Your profile</h2><p class="muted">Sign in to view your details.</p>'; return; }
    if (user.role === 'ADMINISTRATOR') {
      $('#overview-profile').innerHTML = '<p class="eyebrow">Service desk</p><h2 id="overview-profile-title">System overview</h2><p class="muted">All incidents across the service desk.</p><dl>' + field('Signed in as', user.name) + field('Role', 'Administrator') + '</dl><p class="overview-profile-note">Attention highlights tickets ready for assignment. Activity includes all accessible incident history.</p>';
      return;
    }
    $('#overview-profile').innerHTML = `<span class="overview-avatar" aria-hidden="true">${escape(user.name.slice(0, 1).toUpperCase())}</span><h2 id="overview-profile-title">${escape(user.name)}</h2><p class="muted">${escape(human(user.role))}</p><dl>${field('User ID', user.userId)}${user.username ? field('Username', user.username) : ''}${user.email ? field('Email', user.email) : ''}${user.department ? field('Department', user.department) : ''}${typeof user.active === 'boolean' ? field('Account status', user.active ? 'Active' : 'Inactive') : ''}${user.role === 'TECHNICIAN' ? field('Availability', user.available ? 'Available' : 'Unavailable') + field('Active assignments', user.activeIncidentCount) + field('Skills', [...(user.skills || [])].sort().map(human).join(', ') || 'No skills recorded') : ''}</dl>${user.role === 'TECHNICIAN' ? '<p class="overview-profile-note">Active assignments include resolved tickets awaiting closure.</p>' : ''}`;
  }
  const ticket = (row, reason) => `<li><button class="overview-ticket" data-overview-incident="${escape(row.incidentId)}"><span><span class="overview-ticket-id">${escape(row.incidentId)}</span><strong>${escape(row.title)}</strong><span class="muted">${escape(reason)}</span></span><span class="priority priority-${escape(row.priority.toLowerCase())}">${escape(row.priority)}</span></button></li>`;
  function render() {
    renderProfile(); controls();
    const view = buildView(state.rows, state.logs, state.user?.role);
    const ready = !!state.updated;
    $('#overview-summary').innerHTML = [['Open', view.open], ['Awaiting your action', view.attention.length], ['Completed', view.completed]].map(([label, count]) => `<span>${label}<strong>${ready ? count : '—'}</strong></span>`).join('');
    $('#overview-scope').textContent = state.user?.role === 'ADMINISTRATOR' ? 'All service desk incidents' : state.user?.role === 'TECHNICIAN' ? 'Your assigned incidents' : 'Your reported incidents';
    $('#overview-attention-items').innerHTML = view.attention.map(row => ticket(row, row.reason)).join('');
    $('#overview-attention-count').textContent = ready ? `${view.attention.length} tickets` : '';
    $('#overview-attention-empty').hidden = view.attention.length > 0;
    $('#overview-attention-empty').textContent = state.loading && !ready ? 'Loading tickets…' : !ready ? 'Refresh to load tickets needing action.' : 'No recorded ticket activity yet.';
    $('#overview-sla').hidden = !view.warnings.length;
    $('#overview-sla-count').textContent = `${view.warnings.length} active ticket${view.warnings.length === 1 ? '' : 's'} at risk or breached. Showing up to 3, breaches first.`;
    $('#overview-sla-items').innerHTML = view.warnings.slice(0, 3).map(row => ticket(row, human(row.slaStatus))).join('');
    state.recent = view.recent?.incidentId || null;
    $('#overview-continue').hidden = !view.recent;
    $('#overview-continue-description').textContent = view.recent ? `${view.recent.incidentId} · ${view.recent.title}` : '';
    $('#overview-continue-button').textContent = view.recent ? `Open ${view.recent.incidentId}` : 'Open ticket';
    const people = state.people || [];
    $('#overview-activity-items').innerHTML = view.activity.map(log => `<li><div class="overview-event-heading"><strong>${escape(human(log.action))}</strong><time datetime="${escape(log.timestamp)}">${escape(date(log.timestamp))}</time></div><button class="incident-link" data-overview-incident="${escape(log.incidentId)}">${escape(log.incidentId)} · ${escape(log.title)}</button><p>${escape(log.description)}</p><span class="muted">${escape(people.find(person => person.userId === log.userId)?.name || log.userId)} · ${escape(human(log.newState))}</span></li>`).join('');
    $('#overview-activity-empty').hidden = view.activity.length > 0;
    $('#overview-activity-empty').textContent = state.loading && !ready ? 'Loading recorded activity…' : !ready ? 'Refresh to load recorded activity.' : 'No recorded ticket activity yet.';
  }
  function cancel() { state.version++; state.controller?.abort(); state.controller = null; state.loading = false; }
  async function refresh() {
    if (!active() || state.loading) return;
    const version = ++state.version;
    state.controller = new AbortController(); const signal = state.controller.signal;
    state.loading = true; render();
    $('#overview-updated').textContent = state.updated ? 'Refreshing overview…' : 'Loading overview…';
    try {
      const result = await window.ITSMApi.request('/incidents', { signal });
      const current = () => version === state.version && !!active();
      if (!current()) return;
      const [logs, profile] = await Promise.all([
        window.ITSMHistoryViews.collectHistory(result.incidents, id => window.ITSMApi.request(`/incidents/${encodeURIComponent(id)}`, { signal }), current),
        state.user.role === 'TECHNICIAN' ? window.ITSMApi.request(`/technicians/${encodeURIComponent(state.user.userId)}`, { signal }) : Promise.resolve({ ...state.user, ...result.users.find(user => user.userId === state.user.userId) })
      ]);
      if (!current()) return;
      state.rows = result.incidents; state.logs = logs; state.profile = profile; state.people = result.users; state.updated = new Date();
      $('#overview-notice').hidden = true;
      $('#overview-updated').textContent = `Last updated ${state.updated.toLocaleTimeString()}`;
    } catch (error) {
      if (version !== state.version) return;
      state.controller?.abort();
      if (error.status === 401) { document.dispatchEvent(new CustomEvent('sessionexpired')); return; }
      $('#overview-notice').textContent = error.message; $('#overview-notice').hidden = false;
      $('#overview-updated').textContent = state.updated ? `Refresh failed · showing previous snapshot from ${state.updated.toLocaleTimeString()}` : 'Unable to load overview. Use Refresh to retry.';
    } finally { if (version === state.version) { state.loading = false; state.controller = null; render(); } }
  }
  $('#refresh-overview').addEventListener('click', refresh);
  $('#overview-incidents').addEventListener('click', () => { selectSection('Incidents'); $('#main').focus(); });
  $('#overview-create').addEventListener('click', () => document.dispatchEvent(new CustomEvent('createincident')));
  $('#overview-continue-button').addEventListener('click', () => { if (state.recent) document.dispatchEvent(new CustomEvent('openincident', { detail: state.recent })); });
  $('#overview-workspace').addEventListener('click', event => {
    const target = event.target.closest('[data-overview-incident]');
    if (target) document.dispatchEvent(new CustomEvent('openincident', { detail: target.dataset.overviewIncident }));
  });
  document.addEventListener('sessionchange', event => {
    const changed = state.user?.userId !== event.detail?.userId;
    state.user = event.detail;
    if (changed || !state.user) {
      cancel(); state.rows = []; state.logs = []; state.people = []; state.profile = null; state.updated = null;
      $('#overview-notice').hidden = true; $('#overview-updated').textContent = 'Sign in to view your overview.'; render();
      if (active()) refresh();
    }
  });
  document.addEventListener('sectionchange', event => {
    cancel(); state.section = event.detail; controls();
    if (active()) refresh();
  });
  document.addEventListener('incidentsnapshot', event => { if (active() && event.detail.userId === state.user.userId) refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && active()) refresh(); });
  render();
})();
