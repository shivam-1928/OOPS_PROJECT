(() => {
  'use strict';
  const completed = row => ['RESOLVED', 'VERIFIED', 'CLOSED'].includes(row.status);
  const breached = row => ['RESPONSE SLA BREACHED', 'RESOLUTION SLA BREACHED'].includes(row.slaStatus);
  const pendingDeadline = row => completed(row) ? Infinity : Date.parse(row.acknowledgedAt ? row.resolutionDeadline : row.responseDeadline);
  const attention = row => completed(row) ? 3 : breached(row) ? 0 : row.slaStatus === 'AT RISK' ? 1 : 2;
  const idOrder = (a, b) => a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true });
  function selectIncidents(rows, filters = {}, query = '', sort = 'attention') {
    const search = query.trim().toLowerCase();
    return rows.filter(row => {
      const scope = filters.scope || 'active';
      if (scope === 'active' && completed(row) || scope === 'completed' && !completed(row)) return false;
      if (filters.slaStatus && (filters.slaStatus === 'BREACHED' ? !breached(row) : row.slaStatus !== filters.slaStatus)) return false;
      if (filters.priority && row.priority !== filters.priority) return false;
      if (filters.technicianId && (filters.technicianId === 'UNASSIGNED' ? row.technicianId != null : row.technicianId !== filters.technicianId)) return false;
      return !search || `${row.incidentId} ${row.title}`.toLowerCase().includes(search);
    }).sort((a, b) => {
      const deadlineOrder = () => (pendingDeadline(a) - pendingDeadline(b)) || 0;
      const priorityOrder = () => a.priority.localeCompare(b.priority);
      if (sort === 'id') return idOrder(a, b);
      if (sort === 'priority') return priorityOrder() || deadlineOrder() || idOrder(a, b);
      if (sort === 'deadline') return deadlineOrder() || priorityOrder() || idOrder(a, b);
      return attention(a) - attention(b) || deadlineOrder() || priorityOrder() || idOrder(a, b);
    });
  }
  function summarize(rows) {
    const active = rows.filter(row => !completed(row));
    return { active: active.length, within: active.filter(row => row.slaStatus === 'WITHIN SLA').length,
      risk: active.filter(row => row.slaStatus === 'AT RISK').length, breached: active.filter(breached).length };
  }
  // Export view-only helpers for Node tests. SLA decisions remain in Java.
  if (typeof module !== 'undefined' && module.exports) module.exports = { selectIncidents, summarize, pendingDeadline };
  if (typeof document === 'undefined') return;

  const $ = selector => document.querySelector(selector);
  const api = window.ITSMApi;
  const state = { user: window.ITSMCurrentUser || null, section: 'Incidents', rows: [], users: [], version: 0, loading: false, saving: false, timer: null, updatedAt: null };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = value => String(value).toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bsla\b/g, 'SLA');
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const person = id => state.users.find(user => user.userId === id)?.name || id || 'Unassigned';
  const isActive = () => state.section === 'SLA monitoring' && state.user != null;
  function notice(message, error = false) {
    $('#sla-notice').textContent = message; $('#sla-notice').hidden = !message;
    $('#sla-notice').classList.toggle('error', error); $('#sla-notice').setAttribute('role', error ? 'alert' : 'status');
  }
  function controls() {
    $('#refresh-sla').disabled = !state.user || state.loading || state.saving;
    $('#escalate-sla').hidden = state.user?.role !== 'ADMINISTRATOR';
    $('#escalate-sla').disabled = !state.user || state.loading || state.saving;
    $('#sla-search').disabled = !state.user;
    $('#sla-auto-refresh').disabled = !state.user;
    $('#sla-filters').querySelectorAll('select, button').forEach(control => { control.disabled = !state.user; });
    $('#sla-register').setAttribute('aria-busy', String(state.loading));
  }
  function stopTimer() { clearTimeout(state.timer); state.timer = null; }
  function schedule() {
    stopTimer();
    if (isActive() && $('#sla-auto-refresh').checked && document.visibilityState === 'visible') {
      state.timer = setTimeout(() => { if (!state.saving) refresh(); else schedule(); }, 30000);
    }
  }
  function reset() {
    stopTimer(); state.version++; state.rows = []; state.users = []; state.updatedAt = null; state.loading = false;
    $('#sla-search').value = ''; $('#sla-filters').reset(); $('#sla-sort').value = 'attention';
    $('#sla-technician-filter').innerHTML = '<option value="">All technicians</option><option value="UNASSIGNED">Unassigned</option>';
    $('#sla-last-updated').textContent = 'Not refreshed yet';
    notice(''); controls(); render();
  }
  async function refresh() {
    if (!state.user || state.loading) return false;
    stopTimer(); const version = ++state.version;
    state.loading = true; controls();
    if (!state.rows.length) { $('#sla-table-state').hidden = false; $('#sla-table-state').textContent = 'Loading SLA data…'; }
    try {
      const result = await api.request('/incidents');
      if (version !== state.version) return false;
      state.rows = result.incidents; state.users = result.users; state.updatedAt = new Date();
      const current = $('#sla-technician-filter').value;
      const technicians = [...new Map(result.users.filter(user => user.role === 'TECHNICIAN').map(user => [user.userId, user])).values()];
      $('#sla-technician-filter').innerHTML = '<option value="">All technicians</option><option value="UNASSIGNED">Unassigned</option>' + technicians.map(user => `<option value="${escape(user.userId)}">${escape(user.name)} · ${escape(user.userId)}</option>`).join('');
      if ([...$('#sla-technician-filter').options].some(option => option.value === current)) $('#sla-technician-filter').value = current;
      $('#sla-context').textContent = state.user.role === 'ADMINISTRATOR' ? 'All incidents · backend SLA states' : state.user.role === 'TECHNICIAN' ? 'Your assigned incidents · backend SLA states' : 'Your reported incidents · backend SLA states';
      $('#sla-last-updated').textContent = `Last updated ${state.updatedAt.toLocaleTimeString()}`;
      if ($('#sla-notice').classList.contains('error')) notice('');
      render(); return true;
    } catch (error) {
      if (version !== state.version) return false;
      if (error.status === 401) { document.dispatchEvent(new CustomEvent('sessionexpired')); return false; }
      notice(error.message, true);
      $('#sla-last-updated').textContent = state.updatedAt ? `Last updated ${state.updatedAt.toLocaleTimeString()} · refresh failed, showing previous data` : 'Refresh failed';
      if (!state.rows.length) { $('#sla-table-state').hidden = false; $('#sla-table-state').textContent = 'Unable to load SLA data. Use Refresh to retry.'; }
      return false;
    } finally {
      if (version === state.version) { state.loading = false; controls(); schedule(); }
    }
  }
  function checkpoint(row, response) {
    const deadline = response ? row.responseDeadline : row.resolutionDeadline;
    const recorded = response ? row.acknowledgedAt : row.resolvedAt;
    let label;
    if (recorded) label = `${response ? 'Acknowledged' : 'Resolved'} ${date(recorded)}`;
    else if (completed(row)) label = response ? 'No acknowledgement recorded' : 'No resolution timestamp recorded';
    else label = response ? 'Awaiting acknowledgement' : 'Awaiting resolution';
    return `<time datetime="${escape(deadline)}">${escape(date(deadline))}</time><span class="row-secondary">${escape(label)}</span>`;
  }
  function render() {
    const filters = Object.fromEntries(new FormData($('#sla-filters')));
    const rows = selectIncidents(state.rows, filters, $('#sla-search').value, $('#sla-sort').value);
    $('#sla-rows').innerHTML = rows.map(row => `<tr><td><button class="incident-link" data-sla-incident="${escape(row.incidentId)}">${escape(row.incidentId)}</button><span class="sla-incident-title">${escape(row.title)}</span><span class="row-secondary">${escape(human(row.status))}</span></td><td><span class="priority priority-${escape(row.priority.toLowerCase())}">${escape(row.priority)}</span></td><td><span class="sla-state ${breached(row) ? 'sla-state-breached' : row.slaStatus === 'AT RISK' ? 'sla-state-risk' : ''}">${escape(human(row.slaStatus))}</span>${row.status === 'ESCALATED' ? '<span class="row-secondary">Escalated</span>' : ''}</td><td>${checkpoint(row, true)}</td><td>${checkpoint(row, false)}</td><td>${escape(person(row.technicianId))}</td></tr>`).join('');
    $('#sla-result-count').textContent = `${rows.length} of ${state.rows.length} visible incidents`;
    $('#sla-table-state').hidden = rows.length > 0;
    $('#sla-table-state').textContent = !state.user ? 'Sign in to view SLA monitoring.' : state.rows.length ? 'No incidents match these filters. Try a different lifecycle or SLA status.' : 'No incidents to monitor yet.';
    const summary = summarize(state.rows);
    for (const key of ['active', 'within', 'risk', 'breached']) $(`#sla-${key}`).textContent = summary[key];
  }
  $('#sla-search').addEventListener('input', render);
  $('#sla-filters').addEventListener('input', render);
  $('#sla-filters').addEventListener('reset', () => setTimeout(render, 0));
  $('#sla-sort').addEventListener('change', render);
  $('#sla-auto-refresh').addEventListener('change', schedule);
  $('#refresh-sla').addEventListener('click', () => { notice(''); refresh(); });
  $('#sla-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-sla-incident]');
    if (button) document.dispatchEvent(new CustomEvent('openincident', { detail: button.dataset.slaIncident }));
  });
  $('#escalate-sla').addEventListener('click', async () => {
    if (state.saving || state.loading || state.user?.role !== 'ADMINISTRATOR') return;
    const actor = state.user.userId;
    state.saving = true; stopTimer(); controls(); notice('');
    try {
      const result = await api.request('/escalate', { method: 'POST' });
      if (state.user?.userId !== actor) return;
      notice(`${result.count} incident${result.count === 1 ? '' : 's'} escalated for SLA breaches.`);
      await refresh();
    } catch (error) {
      if (state.user?.userId !== actor) return;
      if (error.status === 401) document.dispatchEvent(new CustomEvent('sessionexpired'));
      else notice(error.message, true);
    } finally { state.saving = false; controls(); schedule(); }
  });
  document.addEventListener('sessionchange', event => {
    const changed = state.user?.userId !== event.detail?.userId;
    state.user = event.detail;
    if (changed || !state.user) reset();
    controls();
    if (changed && isActive()) refresh();
  });
  document.addEventListener('sectionchange', event => {
    state.section = event.detail;
    stopTimer();
    if (isActive()) { notice(''); refresh(); }
  });
  document.addEventListener('visibilitychange', () => {
    stopTimer();
    if (isActive() && document.visibilityState === 'visible' && $('#sla-auto-refresh').checked && !state.saving) refresh();
  });
  controls();
})();
