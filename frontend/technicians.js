(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const api = window.ITSMApi;
  const state = { user: window.ITSMCurrentUser || null, rows: [], categories: [], selected: null, detail: null, section: 'Incidents', listVersion: 0, detailVersion: 0, saving: false };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = value => value.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const skills = row => [...row.skills].sort((a, b) => a.localeCompare(b));
  const skillMarkup = row => skills(row).length ? skills(row).map(skill => `<span class="technician-skill">${escape(human(skill))}</span>`).join('') : '<span class="muted">No skills recorded</span>';
  const availability = row => `<span class="status ${row.available ? '' : 'neutral'}">${row.available ? 'Available' : 'Unavailable'}</span>`;
  function notice(message, error = false) {
    $('#technician-notice').textContent = message;
    $('#technician-notice').hidden = !message;
    $('#technician-notice').classList.toggle('error', error);
    $('#technician-notice').setAttribute('role', error ? 'alert' : 'status');
  }
  function errorMessage(error, inDetail = false) {
    if (error.status === 401) { document.dispatchEvent(new CustomEvent('sessionexpired')); return; }
    if (inDetail && $('#technician-detail-error')) {
      $('#technician-detail-error').textContent = error.message;
      $('#technician-detail-error').hidden = false;
      $('#technician-detail-error').focus();
    } else notice(error.message, true);
  }
  function setControls() {
    $('#refresh-technicians').disabled = !state.user;
    $('#technician-search').disabled = !state.user;
    $('#technician-filters').querySelectorAll('input, select, button').forEach(control => { control.disabled = !state.user; });
  }
  function reset() {
    state.rows = []; state.detail = null; state.selected = null;
    state.listVersion++; state.detailVersion++;
    $('#technician-dialog').close(); $('#technician-detail-content').replaceChildren();
    $('#technician-filters').reset(); $('#technician-search').value = ''; $('#technician-sort').value = 'workload';
    $('#technician-skill-filter').innerHTML = '<option value="">All skills</option>';
    $('#technician-register').setAttribute('aria-busy', 'false');
    notice(''); setControls(); render();
  }
  async function refresh() {
    if (!state.user) return;
    const version = ++state.listVersion;
    $('#technician-register').setAttribute('aria-busy', 'true'); $('#refresh-technicians').disabled = true;
    if (!state.rows.length) { $('#technician-table-state').hidden = false; $('#technician-table-state').textContent = 'Loading technicians…'; }
    try {
      const result = await api.request('/technicians');
      if (version !== state.listVersion) return false;
      state.rows = result.technicians; state.categories = result.categories;
      const currentSkill = $('#technician-skill-filter').value;
      const allSkills = [...new Set(state.rows.flatMap(row => row.skills))].sort();
      $('#technician-skill-filter').innerHTML = '<option value="">All skills</option>' + allSkills.map(skill => `<option value="${escape(skill)}">${escape(human(skill))}</option>`).join('');
      if (allSkills.includes(currentSkill)) $('#technician-skill-filter').value = currentSkill;
      $('#technician-context').textContent = result.canManage ? 'Manage availability, skills and workload' : 'Skills, availability and current workload';
      render(); return true;
    } catch (error) {
      if (version !== state.listVersion) return false;
      errorMessage(error);
      if (!state.rows.length && state.user) { $('#technician-table-state').hidden = false; $('#technician-table-state').textContent = 'Unable to load technicians. Use Refresh to retry.'; }
      return false;
    } finally {
      if (version === state.listVersion) { $('#technician-register').setAttribute('aria-busy', 'false'); $('#refresh-technicians').disabled = !state.user; }
    }
  }
  function render() {
    const query = $('#technician-search').value.trim().toLowerCase();
    const filters = Object.fromEntries(new FormData($('#technician-filters')));
    const rows = state.rows.filter(row => {
      if (query && !`${row.userId} ${row.name} ${row.skills.join(' ')}`.toLowerCase().includes(query)) return false;
      if (filters.availability && row.available !== (filters.availability === 'available')) return false;
      if (filters.skill && !row.skills.includes(filters.skill)) return false;
      if (filters.workload === 'idle' && row.activeIncidentCount !== 0) return false;
      if (filters.workload === 'assigned' && row.activeIncidentCount === 0) return false;
      return true;
    });
    const order = $('#technician-sort').value;
    rows.sort((a, b) => (order === 'name' ? a.name.localeCompare(b.name) : order === 'id' ? a.userId.localeCompare(b.userId, undefined, { numeric: true }) : (a.activeIncidentCount - b.activeIncidentCount) * (order === 'busiest' ? -1 : 1)) || a.userId.localeCompare(b.userId));
    $('#tech-name-header').removeAttribute('aria-sort'); $('#tech-workload-header').removeAttribute('aria-sort');
    if (order === 'name') $('#tech-name-header').setAttribute('aria-sort', 'ascending');
    if (['workload', 'busiest'].includes(order)) $('#tech-workload-header').setAttribute('aria-sort', order === 'workload' ? 'ascending' : 'descending');
    $('#technician-rows').innerHTML = rows.map(row => `<tr><td><button class="incident-link" data-technician="${escape(row.userId)}" aria-label="View technician ${escape(row.userId)}">${escape(row.userId)}</button></td><td><span class="technician-name">${escape(row.name)}</span><span class="row-secondary">${escape(row.email)}</span></td><td><div class="technician-skills">${skillMarkup(row)}</div></td><td>${availability(row)}</td><td><span class="workload-number">${row.activeIncidentCount}</span><span class="row-secondary">active</span></td></tr>`).join('');
    $('#technician-table-state').hidden = rows.length > 0;
    $('#technician-table-state').textContent = !state.user ? 'Sign in to view technicians.' : !state.rows.length ? 'No technicians registered.' : 'No technicians match these filters. Clear filters or change your search.';
    $('#technician-result-count').textContent = `${rows.length} of ${state.rows.length} technicians`;
    $('#tech-total').textContent = state.rows.length;
    $('#tech-available').textContent = state.rows.filter(row => row.available).length;
    $('#tech-unavailable').textContent = state.rows.filter(row => !row.available).length;
    $('#tech-assignments').textContent = state.rows.reduce((sum, row) => sum + row.activeIncidentCount, 0);
  }
  function markup(row) {
    return `<p class="detail-id">${escape(row.userId)}</p><h3 class="detail-incident-title">${escape(row.name)}</h3><div class="detail-badges">${availability(row)}<span class="muted">${row.activeIncidentCount} active assignment${row.activeIncidentCount === 1 ? '' : 's'}</span></div>
      <p id="technician-detail-error" class="form-error" tabindex="-1" role="alert" hidden></p><p id="technician-detail-success" class="technician-save-message" tabindex="-1" role="status" hidden></p>
      <dl class="detail-facts"><div><dt>Email</dt><dd>${escape(row.email)}</dd></div><div><dt>Account status</dt><dd>${row.active ? 'Active' : 'Inactive'}</dd></div></dl>
      <section class="detail-section"><h3>Technical skills</h3><div class="technician-skills">${skillMarkup(row)}</div>
      ${row.canManage ? `<form class="technician-action-form" data-technician-action="skills"><label>Add a skill<input name="skill" list="technician-skill-suggestions" required placeholder="Choose or enter a skill" autocomplete="off"></label><datalist id="technician-skill-suggestions">${state.categories.map(category => `<option value="${escape(category)}"></option>`).join('')}</datalist><p class="field-help">Skills are stored in uppercase. Adding an existing skill keeps a single copy.</p><button type="submit" class="secondary-button">Add skill</button></form>` : ''}</section>
      <section class="detail-section"><h3>Assignment availability</h3><p class="field-help">Unavailable technicians are skipped by both assignment strategies. Their existing incidents remain assigned and can still be investigated.</p>
      ${row.canManage && row.active ? `<form class="technician-action-form" data-technician-action="availability"><label>Availability<select name="available"><option value="true" ${row.available ? 'selected' : ''}>Available for new assignments</option><option value="false" ${!row.available ? 'selected' : ''}>Unavailable for new assignments</option></select></label><button class="primary-button" type="submit">Save availability</button></form>` : `<p class="muted">${!row.active ? 'This account is inactive.' : 'An administrator can change availability and add skills.'}</p>`}</section>
      <section class="detail-section"><div class="technician-assignment-heading"><h3>Assigned incidents</h3><label class="sr-only" for="technician-assignment-view">Which assigned incidents to show</label><select id="technician-assignment-view"><option value="active">Active assignments</option><option value="all">All assignments</option></select></div>
      <p class="field-help">${row.allAssignmentsVisible ? 'All assignments are visible to your account.' : 'Only incidents you are authorized to view are listed. The workload total may include other incidents.'} Resolved and verified incidents remain active until closed.</p><div id="technician-assignment-list"></div></section>`;
  }
  function renderAssignments() {
    const row = state.detail; if (!row || !$('#technician-assignment-list')) return;
    const all = $('#technician-assignment-view').value === 'all';
    const records = row.incidents.filter(i => all || i.status !== 'CLOSED').sort((a, b) => a.priority.localeCompare(b.priority) || a.incidentId.localeCompare(b.incidentId));
    $('#technician-assignment-list').innerHTML = records.length ? `<ul class="technician-assignment-list">${records.map(i => `<li><div><button class="incident-link" data-technician-incident="${escape(i.incidentId)}">${escape(i.incidentId)}</button><span class="priority priority-${escape(i.priority.toLowerCase())}">${escape(i.priority)}</span><span data-status="${escape(i.status)}" class="status neutral">${escape(human(i.status))}</span></div><p>${escape(i.title)}</p></li>`).join('')}</ul>` : `<p class="muted">${row.allAssignmentsVisible ? 'No ' : 'No visible '}${all ? '' : 'active '}assigned incidents.</p>`;
  }
  async function openDetail(id) {
    if (state.saving) return;
    const version = ++state.detailVersion; state.selected = id; state.detail = null;
    $('#technician-detail-content').textContent = 'Loading technician…';
    if (!$('#technician-dialog').open) $('#technician-dialog').showModal();
    try {
      const row = await api.request(`/technicians/${encodeURIComponent(id)}`);
      if (version !== state.detailVersion || !$('#technician-dialog').open) return;
      state.detail = row; $('#technician-detail-content').innerHTML = markup(row); renderAssignments();
    } catch (error) {
      if (version !== state.detailVersion) return;
      if (error.status === 401) { errorMessage(error); return; }
      $('#technician-detail-content').innerHTML = `<p class="form-error" role="alert">${escape(error.message)}</p><button type="button" class="secondary-button" id="retry-technician-detail">Retry</button>`;
      $('#retry-technician-detail').addEventListener('click', () => openDetail(id));
    }
  }
  $('#technician-search').addEventListener('input', render);
  $('#technician-filters').addEventListener('input', render);
  $('#technician-filters').addEventListener('reset', () => setTimeout(render, 0));
  $('#technician-sort').addEventListener('change', render);
  $('#refresh-technicians').addEventListener('click', () => { notice(''); refresh(); });
  $('#technician-rows').addEventListener('click', event => { const button = event.target.closest('[data-technician]'); if (button) openDetail(button.dataset.technician); });
  $('#technician-detail-content').addEventListener('change', event => { if (event.target.id === 'technician-assignment-view') renderAssignments(); });
  $('#technician-detail-content').addEventListener('click', event => {
    const button = event.target.closest('[data-technician-incident]');
    if (!button || state.saving) return;
    $('#technician-dialog').close();
    document.dispatchEvent(new CustomEvent('openincident', { detail: button.dataset.technicianIncident }));
  });
  $('#refresh-technician-detail').addEventListener('click', async () => {
    if (state.saving || !state.selected) return;
    const id = state.selected; await refresh();
    if (state.user && $('#technician-dialog').open) await openDetail(id);
  });
  $('#technician-detail-content').addEventListener('submit', async event => {
    const form = event.target.closest('[data-technician-action]'); if (!form) return;
    event.preventDefault(); if (state.saving) return;
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.technicianAction === 'skills' && !data.skill.trim()) { errorMessage(new Error('Please enter a nonblank skill.'), true); return; }
    const id = state.selected; state.saving = true;
    $('#technician-dialog').setAttribute('aria-busy', 'true');
    $('#technician-detail-error').hidden = true; $('#technician-detail-success').hidden = true;
    $('#technician-dialog').querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
    try {
      const row = await api.request(`/technicians/${encodeURIComponent(id)}/${form.dataset.technicianAction}`, { method: 'POST', data });
      state.detail = row; $('#technician-detail-content').innerHTML = markup(row); renderAssignments();
      $('#technician-detail-success').textContent = form.dataset.technicianAction === 'skills' ? 'Skill saved.' : 'Availability saved.';
      $('#technician-detail-success').hidden = false; $('#technician-detail-success').focus({ preventScroll: true });
      await refresh();
      document.dispatchEvent(new CustomEvent('technicianschanged'));
    } catch (error) { errorMessage(error, true); }
    finally {
      state.saving = false; $('#technician-dialog').setAttribute('aria-busy', 'false');
      $('#technician-dialog').querySelectorAll('button, input, select').forEach(control => { control.disabled = false; });
    }
  });
  $('#technician-dialog').addEventListener('cancel', event => { if (state.saving) event.preventDefault(); });
  $('#technician-dialog').addEventListener('close', () => { state.detailVersion++; state.selected = null; });
  document.addEventListener('sessionchange', event => {
    const changed = state.user?.userId !== event.detail?.userId;
    state.user = event.detail;
    if (changed || !state.user) reset();
    setControls();
    if (changed && state.user && state.section === 'Technicians') refresh();
  });
  document.addEventListener('sectionchange', event => {
    state.section = event.detail;
    if (state.section === 'Technicians' && state.user) { notice(''); refresh(); }
  });
  setControls();
})();
