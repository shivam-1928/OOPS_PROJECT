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
  const categories = ['NETWORK', 'HARDWARE', 'SOFTWARE', 'EMAIL', 'ACCESS', 'OTHER'];

  function buildAnalytics(rows, category = '', now = new Date()) {

    const counts = categories.map(category => ({ category, count: rows.filter(row => row.category === category).length }));

    const dates = Array.from({ length: 30 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i));

    const key = date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

    const indexes = new Map(dates.map((date, i) => [key(date), i]));

    const values = Array(30).fill(0);

    for (const row of rows) {

      const date = new Date(row.createdAt), index = indexes.get(key(date));

      if ((!category || row.category === category) && index !== undefined && date <= now) values[index]++;

    }

    return { counts, dates, values };

  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { attentionReason, buildView, buildAnalytics };

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
    $('#overview-profile').innerHTML = `${user.profilePicture ? `<img class="overview-avatar profile-picture" src="${escape(user.profilePicture)}" alt="Your profile picture">` : `<span class="overview-avatar" aria-hidden="true">${escape(user.name.slice(0, 1).toUpperCase())}</span>`}<h2 id="overview-profile-title">${escape(user.name)}</h2><p class="muted">${escape(human(user.role))}</p><dl>${field('User ID', user.userId)}${user.username ? field('Username', user.username) : ''}${user.email ? field('Email', user.email) : ''}${user.phone ? field('Phone', user.phone) : ''}${user.department ? field('Department', user.department) : ''}${typeof user.active === 'boolean' ? field('Account status', user.active ? 'Active' : 'Inactive') : ''}${user.role === 'TECHNICIAN' ? field('Availability', user.available ? 'Available' : 'Unavailable') + field('Active assignments', user.activeIncidentCount) + field('Skills', [...(user.skills || [])].sort().map(human).join(', ') || 'No skills recorded') : ''}</dl>${user.role === 'TECHNICIAN' ? '<p class="overview-profile-note">Active assignments include resolved tickets awaiting closure.</p>' : ''}`;

  }
  const ticket = (row, reason) => `<li><button class="overview-ticket" data-overview-incident="${escape(row.incidentId)}"><span><span class="overview-ticket-id">${escape(row.incidentId)}</span><strong>${escape(row.title)}</strong><span class="muted">${escape(reason)}</span></span><span class="priority priority-${escape(row.priority.toLowerCase())}">${escape(row.priority)}</span></button></li>`;
  function render() {
    renderProfile(); controls(); renderAnalytics();

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
  const theme = getComputedStyle(document.documentElement);
  const chartColors = Array.from({ length: 6 }, (_, i) => theme.getPropertyValue(`--chart-${i+1}`).trim() || ['#496348', '#acbfa4', '#b98c5e', '#d5bca5', '#777d87', '#ddd5c9'][i]);

  let chartFrame = 0, currentChart = Array(30).fill(0), currentMax = 2, previousChartKey = '';

  function renderAnalytics() {

    const category = $('#frequency-category').value;

    const data = buildAnalytics(state.rows, category);

    const total = data.counts.reduce((sum, item) => sum + item.count, 0);

    let angle = 0;

    const stops = data.counts.filter(item => item.count).map(item => {

      const start = angle; angle += item.count / total * 360;

      return `${chartColors[categories.indexOf(item.category)]} ${start}deg ${angle}deg`;

    });

    $('#overview-category-chart').innerHTML = `<div class="category-donut" role="img" aria-label="${escape(data.counts.map(item => `${human(item.category)}: ${item.count}`).join(', '))}" style="background:${total ? `conic-gradient(${stops.join(',')})` : 'var(--line)'}"><span>${state.updated ? total : '—'}<small>incidents</small></span></div><ul class="chart-legend">${data.counts.map((item, i) => `<li><span class="chart-key" style="background:${chartColors[i]}"></span><span>${human(item.category)}</span><strong>${state.updated ? item.count : '—'}</strong></li>`).join('')}</ul>`;

    $('#analytics-empty').hidden = !state.updated || total > 0;

    const count = data.values.reduce((sum, value) => sum + value, 0);

    $('#frequency-caption').textContent = state.updated ? `${count} ${category ? human(category).toLowerCase() + ' ' : ''}incident${count === 1 ? '' : 's'} reported in the last 30 days. Peak: ${Math.max(...data.values)} in one day.` : 'Loading incident frequency…';

    $('#overview-frequency').setAttribute('aria-label', $('#frequency-caption').textContent);

    const chartKey = JSON.stringify([category, data.values, data.dates[0].toDateString()]);

    if (chartKey === previousChartKey) return;

    previousChartKey = chartKey;

    cancelAnimationFrame(chartFrame);

    const max = Math.max(2, Math.ceil(Math.max(...data.values)/2)*2), fromMax = currentMax, from = currentChart.slice(), started = performance.now();

    const x = i => 38 + i * 18.4;

    $('#frequency-grid').innerHTML = [0, .5, 1].map(fraction => `<line x1="38" x2="572" y1="${176-fraction*144}" y2="${176-fraction*144}" stroke="#ded6cb" stroke-dasharray="3 5"/><text x="28" y="${180-fraction*144}" text-anchor="end">${Math.round(max*fraction)}</text>`).join('') + [0, 14, 29].map(i => `<text x="${x(i)}" y="207" text-anchor="middle">${data.dates[i].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>`).join('');

    function draw(time) {

      const progress = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (time-started)/420), ease = 1-Math.pow(1-progress, 3);

      currentChart = data.values.map((value, i) => from[i] + (value-from[i])*ease);
      currentMax = fromMax + (max-fromMax)*ease;

      const points = currentChart.map((value, i) => `${x(i)},${176-Math.min(value/currentMax, 1)*144}`);

      $('#frequency-line').setAttribute('d', 'M'+points.join(' L'));

      $('#frequency-area').setAttribute('d', `M${x(0)},176 L${points.join(' L')} L${x(29)},176 Z`);

      $('#frequency-bars').innerHTML = currentChart.map((value, i) => `<rect x="${x(i)-4}" y="${176-Math.min(value/currentMax,1)*144}" width="8" height="${Math.min(value/currentMax,1)*144}" fill="#496348" opacity=".22"><title>${data.dates[i].toLocaleDateString()}: ${data.values[i]} incidents</title></rect>`).join('');

      if (progress < 1) chartFrame = requestAnimationFrame(draw);

    }

    chartFrame = requestAnimationFrame(draw);

  }

  $('#frequency-category').addEventListener('change', renderAnalytics);

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
  document.addEventListener('profileupdated', event => { state.user = event.detail; state.profile = null; render(); if (active()) refresh(); });

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
