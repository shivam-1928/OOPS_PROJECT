(() => {
  'use strict';
  const validRange = filters => !filters.from || !filters.through || filters.from <= filters.through;
  const inRange = (timestamp, filters) => (!filters.from || timestamp.slice(0, 10) >= filters.from) && (!filters.through || timestamp.slice(0, 10) <= filters.through);
  function filterIncidents(rows, filters = {}) {
    if (!validRange(filters)) return [];
    return rows.filter(row => inRange(row.createdAt, filters) && (!filters.category || row.category === filters.category) && (!filters.priority || row.priority === filters.priority));
  }
  function summary(rows) {
    const closed = rows.filter(row => row.status === 'CLOSED').length;
    const resolved = rows.filter(row => ['RESOLVED', 'VERIFIED'].includes(row.status)).length;
    return { total: rows.length, open: rows.length - closed - resolved, resolved, closed, critical: rows.filter(row => row.priority === 'P1').length };
  }
  function filterHistory(rows, filters = {}, query = '', order = 'newest') {
    if (!validRange(filters)) return [];
    const search = query.trim().toLowerCase();
    return rows.filter(row => inRange(row.timestamp, filters) && (!filters.action || row.action === filters.action) && (!filters.userId || row.userId === filters.userId))
      .filter(row => !search || `${row.incidentId} ${row.title} ${row.action} ${row.userId} ${row.description} ${row.previousState} ${row.newState}`.toLowerCase().replace(/_/g, ' ').includes(search.replace(/_/g, ' ')))
      .sort((a, b) => {
        const timeOrder = a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
        return (timeOrder || a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true }) || a.entryIndex - b.entryIndex) * (order === 'oldest' ? 1 : -1);
      });
  }
  async function collectHistory(incidents, readDetail, isCurrent = () => true, onProgress = () => {}) {
    let cursor = 0, finished = 0, failed = false;
    const logs = [];
    const workers = Array.from({ length: Math.min(4, incidents.length) }, async () => {
      while (!failed && isCurrent() && cursor < incidents.length) {
        const incident = incidents[cursor++];
        try {
          const detail = await readDetail(incident.incidentId);
          if (!Array.isArray(detail.history)) throw new Error('The server returned incomplete incident history.');
          detail.history.forEach((log, entryIndex) => logs.push({ ...log, incidentId: incident.incidentId, title: incident.title, entryIndex }));
          if (isCurrent()) onProgress(++finished, incidents.length);
        } catch (error) { failed = true; throw error; }
      }
    });
    const results = await Promise.allSettled(workers);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw errors.find(error => error.status === 401) || errors[0];
    return logs;
  }
  function csv(rows) {
    return rows.map(row => row.map(value => {
      let text = String(value ?? '');
      if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validRange, filterIncidents, summary, filterHistory, collectHistory, csv };
  if (typeof document === 'undefined') return;
  window.ITSMHistoryViews = { collectHistory, filterHistory };

  const $ = selector => document.querySelector(selector);
  const api = window.ITSMApi;
  const state = {
    user: window.ITSMCurrentUser || null, section: 'Incidents',
    reports: { rows: [], users: [], categories: [], version: 0, loading: false, fresh: false, updated: null },
    audit: { rows: [], users: [], version: 0, loading: false, fresh: false, updated: null, page: 0 }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = value => String(value || '—').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bsla\b/g, 'SLA');
  const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const formValues = name => Object.fromEntries(new FormData($(`#${name}-filters`)));
  const person = (users, id) => users.find(user => user.userId === id)?.name || id;
  function notice(name, message, error = false) {
    $(`#${name}-notice`).textContent = message; $(`#${name}-notice`).hidden = !message;
    $(`#${name}-notice`).classList.toggle('error', error); $(`#${name}-notice`).setAttribute('role', error ? 'alert' : 'status');
  }
  function handleError(name, error) {
    if (error.status === 401) document.dispatchEvent(new CustomEvent('sessionexpired'));
    else notice(name, error.message, true);
  }
  function options(element, entries, first) {
    const current = element.value;
    element.innerHTML = `<option value="">${escape(first)}</option>` + entries.map(([value, text]) => `<option value="${escape(value)}">${escape(text)}</option>`).join('');
    if (entries.some(([value]) => value === current)) element.value = current;
  }
  function controls() {
    for (const name of ['reports', 'audit']) {
      $(`#refresh-${name}`).disabled = !state.user || state[name].loading;
      $(`#${name}-filters`).querySelectorAll('input, select, button').forEach(control => { control.disabled = !state.user; });
    }
    $('#audit-search').disabled = !state.user;
    $('#report-view-technicians').disabled = !state.user;
    $('#audit-register').setAttribute('aria-busy', String(state.audit.loading));
    $('#reports-workspace').setAttribute('aria-busy', String(state.reports.loading));
    $('#export-reports').disabled = !state.user || state.reports.loading || !state.reports.fresh || !validRange(formValues('reports')) || filteredReports().length === 0;
    $('#export-audit').disabled = !state.user || state.audit.loading || !state.audit.fresh || !validRange(formValues('audit')) || filteredAudit().length === 0;
  }
  function reset() {
    for (const name of ['reports', 'audit']) {
      const data = state[name]; data.version++; data.loading = false; data.fresh = false; data.rows = []; data.users = []; data.updated = null;
      $(`#${name}-filters`).reset(); $(`#${name}-updated`).textContent = 'Not refreshed yet'; notice(name, '');
    }
    state.reports.categories = []; state.audit.page = 0; $('#audit-search').value = ''; $('#audit-sort').value = 'newest';
    options($('#reports-category'), [], 'All categories'); options($('#audit-action-filter'), [], 'All actions'); options($('#audit-actor-filter'), [], 'All actors');
    controls(); renderReports(); renderAudit();
  }
  const scope = () => state.user?.role === 'ADMINISTRATOR' ? 'All incidents' : state.user?.role === 'TECHNICIAN' ? 'Your assigned incidents' : 'Your reported incidents';
  async function refreshReports() {
    if (!state.user || state.reports.loading) return;
    const data = state.reports, version = ++data.version;
    data.loading = true; controls(); $('#reports-state').textContent = 'Loading report…';
    try {
      const result = await api.request('/incidents');
      if (version !== data.version) return;
      data.rows = result.incidents; data.users = [...new Map(result.users.map(user => [user.userId, user])).values()]; data.categories = result.categories;
      data.fresh = true; data.updated = new Date(); data.loading = false;
      options($('#reports-category'), result.categories.map(category => [category, human(category)]), 'All categories');
      $('#reports-scope').textContent = `${scope()} · incident totals follow the selected creation dates, category and priority`;
      $('#reports-updated').textContent = `Last updated ${data.updated.toLocaleTimeString()}`;
      notice('reports', ''); renderReports();
    } catch (error) {
      if (version !== data.version) return;
      data.fresh = false; handleError('reports', error);
      $('#reports-state').textContent = data.updated ? 'Showing the previous report snapshot.' : 'Unable to load reports. Use Refresh to retry.';
      $('#reports-updated').textContent = data.updated ? `Last updated ${data.updated.toLocaleTimeString()} · refresh failed` : 'Refresh failed';
    } finally { if (version === data.version) { data.loading = false; controls(); } }
  }
  async function refreshAudit() {
    if (!state.user || state.audit.loading) return;
    const data = state.audit, version = ++data.version;
    const current = () => version === data.version && state.user != null;
    data.loading = true; controls(); $('#audit-table-state').hidden = false; $('#audit-table-state').textContent = 'Loading recorded history…';
    try {
      const result = await api.request('/incidents');
      if (!current()) return;
      const logs = await collectHistory(result.incidents, id => api.request(`/incidents/${encodeURIComponent(id)}`), current, (done, total) => {
        if (done % 5 === 0 || done === total) $('#audit-table-state').textContent = `Loading history · ${done} of ${total} incidents`;
      });
      if (!current()) return;
      data.rows = logs; data.users = result.users; data.fresh = true; data.updated = new Date(); data.loading = false; data.page = 0;
      options($('#audit-action-filter'), [...new Set(logs.map(log => log.action))].sort().map(action => [action, human(action)]), 'All actions');
      options($('#audit-actor-filter'), [...new Set(logs.map(log => log.userId))].sort().map(id => [id, `${person(result.users, id)}${person(result.users, id) !== id ? ` · ${id}` : ''}`]), 'All actors');
      $('#audit-scope').textContent = `${scope()} · read-only backend history`;
      $('#audit-updated').textContent = `Last updated ${data.updated.toLocaleTimeString()}`;
      notice('audit', ''); renderAudit();
    } catch (error) {
      if (!current()) return;
      data.fresh = false; handleError('audit', error);
      $('#audit-table-state').hidden = false;
      $('#audit-table-state').textContent = data.updated ? 'Refresh failed. Showing the previous complete history snapshot.' : 'Unable to load complete history. Use Refresh to retry.';
      $('#audit-updated').textContent = data.updated ? `Last updated ${data.updated.toLocaleTimeString()} · refresh failed` : 'Refresh failed';
    } finally { if (version === data.version) { data.loading = false; controls(); } }
  }
  function filteredReports() { return filterIncidents(state.reports.rows, formValues('reports')).sort((a, b) => a.priority.localeCompare(b.priority) || a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true })); }
  function filteredAudit() { return filterHistory(state.audit.rows, formValues('audit'), $('#audit-search').value, $('#audit-sort').value); }
  function renderReports() {
    const data = state.reports, filters = formValues('reports'), rows = filteredReports(), totals = summary(rows);
    $('#reports-range-error').hidden = validRange(filters);
    $('#reports-filters').querySelectorAll('input[type=date]').forEach(input => { input.setAttribute('aria-invalid', String(!validRange(filters))); if (!validRange(filters)) input.setAttribute('aria-describedby', 'reports-range-error'); else input.removeAttribute('aria-describedby'); });
    for (const key of ['total', 'open', 'resolved', 'closed', 'critical']) $(`#reports-${key}`).textContent = totals[key];
    const countCells = group => { const counts = summary(group); return ['total', 'open', 'resolved', 'closed'].map(key => `<td class="report-number">${counts[key]}</td>`).join(''); };
    $('#report-priority-rows').innerHTML = ['P1', 'P2', 'P3', 'P4'].map(priority => `<tr><td><span class="priority priority-${priority.toLowerCase()}">${priority}</span></td>${countCells(rows.filter(row => row.priority === priority))}</tr>`).join('');
    $('#report-category-rows').innerHTML = data.categories.map(category => `<tr><th scope="row">${escape(human(category))}</th>${countCells(rows.filter(row => row.category === category))}</tr>`).join('') || '<tr><td colspan="5">No report data loaded.</td></tr>';
    const technicians = data.users.filter(user => user.role === 'TECHNICIAN').sort((a, b) => b.activeIncidentCount - a.activeIncidentCount || a.userId.localeCompare(b.userId));
    $('#report-workload-rows').innerHTML = technicians.map(user => `<tr><td>${escape(user.name)}</td><td>${escape(user.userId)}</td><td class="report-number">${user.activeIncidentCount}</td><td><span class="status ${user.available ? '' : 'neutral'}">${user.available ? 'Available' : 'Unavailable'}</span></td></tr>`).join('') || '<tr><td colspan="4">No technician data loaded.</td></tr>';
    $('#report-incident-count').textContent = `${rows.length} incidents`;
    $('#report-incident-rows').innerHTML = [...rows].sort((a, b) => a.priority.localeCompare(b.priority) || a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true })).map(row => `<tr><td><button class="incident-link" data-insight-incident="${escape(row.incidentId)}">${escape(row.incidentId)}</button><span class="report-incident-title">${escape(row.title)}</span></td><td>${escape(human(row.category))}</td><td><span class="priority priority-${escape(row.priority.toLowerCase())}">${escape(row.priority)}</span></td><td>${escape(human(row.status))}</td><td>${escape(date(row.createdAt))}</td></tr>`).join('') || '<tr><td colspan="5">No incidents in this report.</td></tr>';
    $('#reports-state').textContent = !state.user ? 'Sign in to view reports.' : !validRange(filters) ? 'Choose a valid creation date range.' : !data.rows.length ? 'No incidents to report yet.' : `${rows.length} of ${data.rows.length} visible incidents included.`;
    controls();
  }
  function renderAudit() {
    const data = state.audit, rows = filteredAudit(), filters = formValues('audit');
    $('#audit-range-error').hidden = validRange(filters);
    $('#audit-filters').querySelectorAll('input[type=date]').forEach(input => { input.setAttribute('aria-invalid', String(!validRange(filters))); if (!validRange(filters)) input.setAttribute('aria-describedby', 'audit-range-error'); else input.removeAttribute('aria-describedby'); });
    $('#audit-total').textContent = data.rows.length;
    $('#audit-incidents').textContent = new Set(data.rows.map(row => row.incidentId)).size;
    $('#audit-actors').textContent = new Set(data.rows.map(row => row.userId)).size;
    const pageSize = 25;
    data.page = Math.max(0, Math.min(data.page, Math.ceil(rows.length / pageSize) - 1));
    const start = data.page * pageSize;
    $('#audit-rows').innerHTML = rows.slice(start, start + pageSize).map(row => `<tr><td><time datetime="${escape(row.timestamp)}">${escape(date(row.timestamp))}</time></td><td><button class="incident-link" data-insight-incident="${escape(row.incidentId)}">${escape(row.incidentId)}</button><span class="row-secondary">${escape(row.title)}</span></td><td>${escape(person(data.users, row.userId))}<span class="row-secondary">${escape(row.userId)}</span></td><td>${escape(human(row.action))}</td><td>${escape(human(row.previousState))}<span class="audit-transition">to ${escape(human(row.newState))}</span></td><td class="audit-description">${escape(row.description)}</td></tr>`).join('');
    $('#audit-table-state').hidden = rows.length > 0;
    $('#audit-table-state').textContent = !state.user ? 'Sign in to view history.' : !validRange(filters) ? 'Choose a valid activity date range.' : !data.rows.length ? 'No recorded incident activity yet.' : 'No events match these filters.';
    $('#audit-result-count').textContent = rows.length ? `${start + 1}–${Math.min(start + pageSize, rows.length)} of ${rows.length} filtered events` : '0 filtered events';
    $('#audit-previous').disabled = !state.user || data.page === 0; $('#audit-next').disabled = !state.user || start + pageSize >= rows.length;
    controls();
  }
  function download(rows, filename) {
    const url = URL.createObjectURL(new Blob(['\ufeff', csv(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const name of ['reports', 'audit']) $(`#${name}-filters`).addEventListener('submit', event => event.preventDefault());
  $('#refresh-reports').addEventListener('click', refreshReports);
  $('#refresh-audit').addEventListener('click', refreshAudit);
  $('#reports-filters').addEventListener('input', renderReports);
  $('#reports-filters').addEventListener('reset', () => setTimeout(renderReports, 0));
  const changeAudit = () => { state.audit.page = 0; renderAudit(); };
  $('#audit-filters').addEventListener('input', changeAudit);
  $('#audit-filters').addEventListener('reset', () => setTimeout(changeAudit, 0));
  $('#audit-search').addEventListener('input', changeAudit); $('#audit-sort').addEventListener('change', changeAudit);
  $('#audit-previous').addEventListener('click', () => { state.audit.page--; renderAudit(); });
  $('#audit-next').addEventListener('click', () => { state.audit.page++; renderAudit(); });
  $('#report-view-technicians').addEventListener('click', () => selectSection('Technicians'));
  for (const name of ['reports', 'audit']) $(`#${name}-workspace`).addEventListener('click', event => {
    const button = event.target.closest('[data-insight-incident]');
    if (button) document.dispatchEvent(new CustomEvent('openincident', { detail: button.dataset.insightIncident }));
  });
  $('#export-reports').addEventListener('click', () => {
    if ($('#export-reports').disabled) return;
    const rows = filteredReports();
    download([['Incident ID', 'Title', 'Category', 'Priority', 'Status', 'Reporter ID', 'Technician ID', 'Created', 'SLA status'], ...rows.map(row => [row.incidentId, row.title, row.category, row.priority, row.status, row.employeeId, row.technicianId, row.createdAt, row.slaStatus])], 'itsm-incidents.csv');
  });
  $('#export-audit').addEventListener('click', () => {
    if ($('#export-audit').disabled) return;
    download([['Timestamp', 'Incident ID', 'Incident title', 'Actor ID', 'Action', 'Previous state', 'New state', 'Description'], ...filteredAudit().map(row => [row.timestamp, row.incidentId, row.title, row.userId, row.action, row.previousState, row.newState, row.description])], 'itsm-audit-history.csv');
  });
  document.addEventListener('sessionchange', event => {
    const changed = state.user?.userId !== event.detail?.userId;
    state.user = event.detail;
    if (changed || !state.user) reset(); controls();
    if (changed && state.user && state.section === 'Reports') refreshReports();
    if (changed && state.user && state.section === 'Audit trail') refreshAudit();
  });
  document.addEventListener('sectionchange', event => {
    if (state.section === 'Audit trail' && state.audit.loading) { state.audit.version++; state.audit.loading = false; controls(); }
    state.section = event.detail;
    if (state.user && state.section === 'Reports') refreshReports();
    if (state.user && state.section === 'Audit trail') refreshAudit();
  });
  controls();
})();
