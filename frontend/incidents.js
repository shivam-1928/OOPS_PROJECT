(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const api = window.ITSMApi;
  const state = { user: null, rows: [], users: [], notifications: [], selected: null, detail: null, section: 'Incidents', listVersion: 0, detailVersion: 0, previewVersion: 0, saving: false, loading: false, reassignment: null };
  const labels = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };
  const actionNames = { assign: 'Assign technician', acknowledge: 'Acknowledge', start: 'Start investigation', 'request-information': 'Request employee information', resume: 'Resume investigation', resolve: 'Resolve incident', verify: 'Verify resolution', close: 'Close incident', 'add-information': 'Add information' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = value => value ? value.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bsla\b/g, 'SLA') : '—';
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const priority = value => `<span class="priority priority-${escape(value.toLowerCase())}">${escape(value)} · ${escape(labels[value])}</span>`;
  const person = id => state.users.find(user => user.userId === id)?.name || id || 'Unassigned';
  const personWithId = id => id && person(id) !== id ? `${person(id)} · ${id}` : id || 'Unassigned';
  const technicianUsername = id => state.users.find(user => user.userId === id)?.username;
  const technicianWithId = id => `${personWithId(id)}${technicianUsername(id) ? ` · Username: ${technicianUsername(id)}` : ''}`;
  function reassignmentForm(row) {
    const view = window.ITSMReassignment;
    const groups = view.groupTechnicians(state.users);
    const available = groups.some(group => group.technicians.some(technician => view.eligible(technician, row.technicianId)));
    return `<form class="action-form" data-action="reassign"><label>Reassign to a different technician<select name="technicianId" required><option value="">Choose a technician</option>${groups.map(group => `<optgroup label="${escape(group.skill === 'NO_SKILLS' ? 'No skills recorded' : human(group.skill))}">${group.technicians.map(technician => `<option value="${escape(technician.userId)}" ${view.eligible(technician, row.technicianId) ? '' : 'disabled'}>${escape(technician.name)} · ${escape(technician.userId)}${technician.username ? ` · @${escape(technician.username)}` : ''} — ${escape(technician.skills.map(human).join(', ') || 'No skills')} · ${technician.activeIncidentCount} active${technician.userId === row.technicianId ? ' · Current technician' : !technician.available ? ' · Unavailable' : ''}</option>`).join('')}</optgroup>`).join('')}</select></label><p class="field-help">Each technician’s full skills are shown. You’ll confirm before the assignment changes.</p>${!available ? '<p class="muted">No other available technicians. Update availability in Technicians, then refresh this ticket.</p>' : ''}<button type="submit" class="secondary-button" ${available ? '' : 'disabled'}>Review reassignment</button></form>`;
  }
  function notice(message, error = false) {
    $('#notice').textContent = message; $('#notice').hidden = !message || state.section !== 'Incidents';
    $('#notice').classList.toggle('error', error); $('#notice').setAttribute('role', error ? 'alert' : 'status');
  }
  function fieldError(id, message) { $(id).textContent = message; $(id).hidden = !message; }
  function authError(error, target) {
    if (error.status === 401) { signOutView('expired'); }
    else if (target) fieldError(target, error.message);
    else notice(error.message, true);
  }
  function setBusy(form, busy) {
    form.setAttribute('aria-busy', String(busy));
    form.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = busy; });
  }
  function updateAccount() {
    const user = state.user;
    $('#profile-name').textContent = user?.name || 'Not signed in';
    $('#profile-role').textContent = user ? `${human(user.role)} · ${user.userId}${user.role === 'TECHNICIAN' ? ` · ${user.activeIncidentCount} active` : ''}` : '';
    $('#account-name').textContent = user?.name || 'Not signed in';
    $('#account-role').textContent = user ? human(user.role) : 'Service desk';
    $('.account-avatar').textContent = user?.name[0] || '?';
    $('#profile-button span').textContent = user?.name[0] || '?';
    for (const avatar of [$('.account-avatar'), $('#profile-button span')]) {
      if (user?.profilePicture) { const image = document.createElement('img'); image.src = user.profilePicture; image.alt = ''; image.className = 'account-photo'; avatar.replaceChildren(image); }
    }
    $('#profile-button').setAttribute('aria-label', user ? `Profile: ${user.name}` : 'Profile');
    $('#logout').hidden = !user;
    $('#new-incident').hidden = user?.role !== 'EMPLOYEE' || state.section !== 'Incidents';
    $('#escalate-incidents').hidden = user?.role !== 'ADMINISTRATOR';
    $('#refresh-incidents').disabled = !user;
    $('#incident-notifications').disabled = !user;
    $('#incident-filters').querySelectorAll('input, select, button').forEach(control => { control.disabled = !user; });
    $('#incident-search').disabled = !user;
    window.ITSMCurrentUser = user;
    document.dispatchEvent(new CustomEvent('sessionchange', { detail: user }));
  }
  function signOutView(reason = '') {
    state.user = null; state.rows = []; state.users = []; state.notifications = []; state.detail = null; state.selected = null;
    state.listVersion++; state.detailVersion++; state.previewVersion++; state.loading = false;
    $('#incident-preview').setAttribute('aria-busy', 'false');
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    $('#create-form').reset(); $('#detail-content').replaceChildren();
    $('#notification-count').textContent = '0';
    $('#incident-filters').reset(); $('#incident-search').value = ''; $('#incident-sort').value = 'priority';
    notice(''); closeProfile(); selectSection('Incidents'); updateAccount(); renderTable();
    $('#table-state').textContent = 'Sign in to view incidents.';
    location.replace(`signin.html${reason ? '?' + reason + '=1' : ''}`);
  }
  function selectOptions(element, values, firstLabel) {
    const current = element.value;
    element.innerHTML = (firstLabel ? `<option value="">${escape(firstLabel)}</option>` : '') + values.map(([value, text]) => `<option value="${escape(value)}">${escape(text)}</option>`).join('');
    if ([...element.options].some(option => option.value === current)) element.value = current;
  }
  async function refresh() {
    if (!state.user) return;
    const version = ++state.listVersion;
    state.loading = true; $('#incident-preview').setAttribute('aria-busy', 'true');
    $('#refresh-incidents').disabled = true;
    if (!state.rows.length) { $('#table-state').hidden = false; $('#table-state').textContent = 'Loading incidents…'; }
    try {
      // Fetch the complete role-scoped list. Five exact filters are applied together below.
      const result = await api.request('/incidents');
      if (version !== state.listVersion) return;
      state.rows = result.incidents; state.users = [...new Map(result.users.map(user => [user.userId, user])).values()]; state.notifications = result.notifications;
      state.user = { ...state.user, ...state.users.find(user => user.userId === state.user.userId) };
      updateAccount();
      selectOptions($('#filter-category'), result.categories.map(value => [value, human(value)]), 'All categories');
      selectOptions($('#create-category'), result.categories.map(value => [value, human(value)]));
      selectOptions($('#filter-status'), result.statuses.map(value => [value, human(value)]), 'All statuses');
      selectOptions($('#filter-technician'), state.users.filter(user => user.role === 'TECHNICIAN').map(user => [user.userId, `${user.name} · ${user.userId}`]), 'All technicians');
      document.dispatchEvent(new CustomEvent('incidentsnapshot', { detail: { userId: state.user.userId, incidents: result.incidents, notifications: result.notifications } }));
      $('#table-context').textContent = state.user.role === 'EMPLOYEE' ? 'Incidents you reported' : state.user.role === 'TECHNICIAN' ? 'Incidents assigned to you' : 'All incidents';
      state.loading = false; renderTable();
    } catch (error) {
      if (version !== state.listVersion) return;
      state.loading = false; authError(error);
      if (state.user && !state.rows.length) { $('#table-state').hidden = false; $('#table-state').textContent = 'Unable to load incidents. Use Refresh to retry.'; }
    } finally {
      if (version === state.listVersion) { state.loading = false; $('#incident-preview').setAttribute('aria-busy', 'false'); $('#refresh-incidents').disabled = !state.user; }
    }
  }
  function renderTable() {
    const filters = Object.fromEntries(new FormData($('#incident-filters')));
    const query = $('#incident-search').value.trim().toLowerCase();
    const rows = state.rows.filter(row => Object.entries(filters).every(([key, value]) => !value.trim() || String(row[key] || '').toLowerCase() === value.trim().toLowerCase()))
      .filter(row => !query || `${row.incidentId} ${row.title}`.toLowerCase().includes(query));
    const sort = $('#incident-sort').value;
    rows.sort((a, b) => sort === 'priority' ? a.priority.localeCompare(b.priority) || a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true }) : sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.incidentId.localeCompare(b.incidentId, undefined, { numeric: true }) * (sort === 'id-desc' ? -1 : 1));
    $('#incident-id-header').removeAttribute('aria-sort'); $('#priority-header').removeAttribute('aria-sort');
    if (sort === 'priority') $('#priority-header').setAttribute('aria-sort', 'ascending');
    if (sort.startsWith('id-')) $('#incident-id-header').setAttribute('aria-sort', sort === 'id-asc' ? 'ascending' : 'descending');
    $('#sort-indicator').textContent = sort === 'id-asc' ? '↑' : sort === 'id-desc' ? '↓' : '↕';
    $('#incident-rows').innerHTML = rows.map(row => `<tr${row.priority === 'P1' ? ' class="critical-incident"' : ''}><td class="incident-id"><button class="incident-link" data-open="${escape(row.incidentId)}">${escape(row.incidentId)}</button></td><td><span class="incident-title">${escape(row.title)}</span><span class="row-secondary">${escape(person(row.employeeId))} · ${escape(date(row.createdAt))}</span></td><td>${escape(human(row.category))}</td><td>${priority(row.priority)}</td><td><span data-status="${escape(row.status)}" class="status ${row.status === 'IN_PROGRESS' ? '' : 'neutral'}">${escape(human(row.status))}</span></td><td>${escape(person(row.technicianId))}${state.user?.role === 'ADMINISTRATOR' && row.technicianId ? `<span class="row-secondary">Technician ID: ${escape(row.technicianId)}${technicianUsername(row.technicianId) ? ` · Username: ${escape(technicianUsername(row.technicianId))}` : ''}</span>` : ''}</td><td><span class="sla-label ${row.slaStatus.includes('BREACHED') ? 'breached' : ''}">${escape(human(row.slaStatus))}</span></td></tr>`).join('');
    $('#result-count').textContent = `${rows.length} of ${state.rows.length} incidents`;
    $('#table-state').hidden = rows.length > 0;
    if (!rows.length && !state.loading) $('#table-state').textContent = !state.user ? 'Sign in to view incidents.' : state.rows.length ? 'No incidents match these filters. Clear filters to see all incidents.' : state.user.role === 'EMPLOYEE' ? 'No incidents reported yet. Use Report incident to get started.' : state.user.role === 'TECHNICIAN' ? 'No incidents assigned to you yet.' : 'No incidents have been reported yet.';
    const done = ['RESOLVED', 'VERIFIED', 'CLOSED'];
    $('#summary-total').textContent = state.rows.length;
    $('#summary-open').textContent = state.rows.filter(row => !done.includes(row.status)).length;
    $('#summary-resolved').textContent = state.rows.filter(row => ['RESOLVED', 'VERIFIED'].includes(row.status)).length;
    $('#summary-closed').textContent = state.rows.filter(row => row.status === 'CLOSED').length;
    const criticalCount = state.rows.filter(row => row.priority === 'P1').length;
    $('#summary-critical').textContent = criticalCount;
    $('#critical-warning').hidden = criticalCount === 0;
  }
  function detailMarkup(row) {
    const facts = [['Reporter', personWithId(row.employeeId)], ['Technician', technicianWithId(row.technicianId)], ['Category', human(row.category)], ['Created', date(row.createdAt)], ['Impact', `${row.impact} / 5`], ['Urgency', `${row.urgency} / 5`], ['Business criticality', `${row.businessCriticality} / 5`], ['Acknowledged', date(row.acknowledgedAt)], ['Resolved', date(row.resolvedAt)], ['Closed', date(row.closedAt)]];
    const techs = state.users.filter(user => user.role === 'TECHNICIAN');
    return `<p class="detail-id">${escape(row.incidentId)}</p><h3 class="detail-incident-title">${escape(row.title)}</h3><div class="detail-badges">${priority(row.priority)}<span data-status="${escape(row.status)}" class="status">${escape(human(row.status))}</span></div>
      <p id="detail-error" class="form-error" role="alert" hidden></p>
      ${state.user?.role === 'ADMINISTRATOR' && row.technicianId ? `<p id="assigned-technician-confirmation" class="notice" role="status" tabindex="-1">Assigned to ${escape(person(row.technicianId))} · <strong>Technician ID: ${escape(row.technicianId)}${technicianUsername(row.technicianId) ? ` · Username: ${escape(technicianUsername(row.technicianId))}` : ''}</strong></p>` : ''}
      <section class="detail-section"><h3>Description & additional information</h3><p class="pre-wrap">${escape(row.description)}</p></section>
      ${row.informationRequests?.length ? `<section class="detail-section information-requests"><h3>Questions & replies</h3>${row.informationRequests.map((request, index) => `<article class="information-exchange"><p class="field-help">${escape(personWithId(request.technicianId))} asked · ${escape(date(request.askedAt))}${row.status === 'WAITING_FOR_EMPLOYEE' && index === row.informationRequests.length - 1 ? ' · Current request' : ''}</p><p class="pre-wrap information-question">${escape(request.question)}</p>${request.replies.map(reply => `<div class="information-reply"><p class="field-help">${escape(personWithId(reply.employeeId))} replied · ${escape(date(reply.timestamp))}</p><p class="pre-wrap">${escape(reply.text)}</p></div>`).join('') || '<p class="muted">No reply recorded for this question yet.</p>'}</article>`).join('')}</section>` : ''}
      <dl class="detail-facts">${facts.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      <section class="detail-section"><h3>Service level agreement</h3><p class="sla-label ${row.slaStatus.includes('BREACHED') ? 'breached' : ''}">${escape(human(row.slaStatus))}</p><dl class="detail-facts"><div><dt>Response deadline</dt><dd>${escape(date(row.responseDeadline))}</dd></div><div><dt>Resolution deadline</dt><dd>${escape(date(row.resolutionDeadline))}</dd></div></dl><p class="field-help">Last checked ${escape(new Date().toLocaleTimeString())}.</p></section>
      ${row.resolutionNotes ? `<section class="detail-section"><h3>Resolution</h3><p class="pre-wrap">${escape(row.resolutionNotes)}</p></section>` : ''}
      <section class="detail-section"><h3 id="actions-heading" tabindex="-1">Available actions</h3>${row.status === 'ESCALATED' && row.technicianId ? '<p class="field-help">An administrator can reassign this escalated ticket. Its original SLA deadlines remain in effect.</p>' : ''}${row.actions.length ? row.actions.map(action => {
        if (action === 'reassign') return reassignmentForm(row);
        if (action === 'assign') return `<form class="action-form" data-action="assign"><p class="field-help">${row.recommendation?.id ? `Recommended: <strong>${escape(row.recommendation.name)}</strong>. ${escape(row.recommendation.reason)}` : 'No technician is currently available.'}</p><input type="hidden" name="recommendedId" value="${escape(row.recommendation?.id || '')}"><label>Assignment strategy<select name="strategy" required>${row.recommendation?.id ? '<option value="RECOMMENDED">Use recommended technician</option>' : ''}<option value="SKILL">Skill-based</option><option value="LOAD">Load-based</option></select></label><p class="field-help">Skill-based selects the first available technician with a matching skill. Load-based selects the available technician with the fewest active incidents.</p><ul class="technician-options">${techs.map(t => `<li>${escape(t.name)} · ${t.activeIncidentCount} active · ${t.available ? 'Available' : 'Unavailable'}<small>${escape(t.skills.map(human).join(', '))}</small></li>`).join('')}</ul><button class="primary-button" type="submit">Assign technician</button></form>`;
        if (action === 'request-information') return Array.isArray(row.informationRequests) ? `<form class="action-form" data-action="request-information"><label>Question for the employee<textarea name="question" rows="3" maxlength="2000" required placeholder="Type here..."></textarea></label><button type="submit" class="secondary-button">Send information request</button></form>` : '<p class="form-error">This server needs the updated backend before questions can be sent.</p>';
        if (['resolve', 'add-information'].includes(action)) return `<form class="action-form" data-action="${action}">${action === 'add-information' && row.status === 'WAITING_FOR_EMPLOYEE' && row.informationRequests?.length ? `<div class="employee-question"><p class="field-help">Reply to the technician’s question</p><p class="pre-wrap">${escape(row.informationRequests[row.informationRequests.length - 1].question)}</p></div>` : ''}<label>${action === 'resolve' ? 'Resolution notes' : row.status === 'WAITING_FOR_EMPLOYEE' && row.informationRequests?.length ? 'Your reply' : 'Additional information'}<textarea name="notes" rows="3" required></textarea></label><button type="submit" class="${action === 'resolve' ? 'primary' : 'secondary'}-button">${actionNames[action]}</button></form>`;
        return `<form class="action-form compact-action" data-action="${action}">${action === 'verify' ? '<p class="field-help">Confirm that the resolution fixed your issue. You can then close the incident.</p>' : ''}<button type="submit" class="secondary-button">${actionNames[action]}</button></form>`;
      }).join('') : '<p class="muted">No actions are available to your account at this stage.</p>'}</section>
      <section class="detail-section"><h3>Possible duplicates</h3>${row.duplicates.length ? `<p class="field-help">Similar incidents in the same category. Suggestions only; no records are merged.</p><ul class="duplicate-list">${row.duplicates.map(other => `<li><button class="incident-link" data-open="${escape(other.incidentId)}">${escape(other.incidentId)}</button> ${escape(other.title)}</li>`).join('')}</ul>` : '<p class="muted">No information available.</p>'}</section>
      <section class="detail-section"><h3>Incident history</h3><ol class="history-list">${row.history.map(log => `<li><p><strong>${escape(human(log.action))}</strong><time>${escape(date(log.timestamp))}</time></p><span>${escape(log.userId)} · ${escape(human(log.previousState))} → ${escape(human(log.newState))}</span><p class="pre-wrap">${escape(log.description)}</p></li>`).join('') || '<li>No history recorded.</li>'}</ol></section>`;
  }
  async function openDetail(id) {
    if (state.saving) return;
    const version = ++state.detailVersion; state.selected = id; state.detail = null;
    $('#detail-content').textContent = 'Loading incident…';
    if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
    try {
      const row = await api.request(`/incidents/${encodeURIComponent(id)}`);
      if (version !== state.detailVersion || !$('#detail-dialog').open) return;
      state.detail = row; $('#detail-content').innerHTML = detailMarkup(row);
    } catch (error) {
      if (version !== state.detailVersion) return;
      if (error.status === 401) authError(error);
      else { $('#detail-content').replaceChildren(); const p = document.createElement('p'); p.className = 'form-error'; p.setAttribute('role', 'alert'); p.textContent = error.message; $('#detail-content').append(p); const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Retry'; button.addEventListener('click', () => openDetail(id)); $('#detail-content').append(button); }
    }
  }
  async function previewPriority() {
    const version = ++state.previewVersion;
    $('#priority-preview').textContent = 'Calculating priority…';
    try {
      const form = new FormData($('#create-form'));
      const result = await api.request('/priority', { method: 'POST', data: { impact: form.get('impact'), urgency: form.get('urgency'), businessCriticality: form.get('businessCriticality') } });
      if (version === state.previewVersion) $('#priority-preview').innerHTML = `Calculated priority ${priority(result.priority)}`;
    } catch (error) { if (version === state.previewVersion) { $('#priority-preview').textContent = error.message; if (error.status === 401) authError(error); } }
  }
  $('#logout').addEventListener('click', async () => {
    $('#logout').disabled = true;
    try { await api.request('/logout', { method: 'POST' }); signOutView(); }
    catch (error) { authError(error); }
    finally { $('#logout').disabled = false; }
  });
  function openCreate() {
    if (state.user?.role !== 'EMPLOYEE' || state.saving || $('#create-dialog').open) return;
    $('#create-form').reset(); fieldError('#create-error', ''); $('#create-dialog').showModal(); previewPriority();
  }
  $('#new-incident').addEventListener('click', openCreate);
  document.addEventListener('createincident', openCreate);
  $('#create-form').addEventListener('change', event => { if (['impact', 'urgency', 'businessCriticality'].includes(event.target.name)) previewPriority(); });
  $('#create-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.saving) return;
    const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
    if (!data.title.trim() || !data.description.trim()) { fieldError('#create-error', 'Title and description cannot be blank.'); return; }
    state.saving = true; setBusy(form, true); fieldError('#create-error', '');
    try {
      const row = await api.request('/incidents', { method: 'POST', data });
      $('#create-dialog').close(); form.reset(); notice(`Incident ${row.incidentId} reported with priority ${row.priority}.${row.duplicates.length ? ` ${row.duplicates.length} possible duplicate(s) found.` : ''}`);
      await refresh(); state.saving = false; if (state.user) await openDetail(row.incidentId);
    } catch (error) { authError(error, '#create-error'); }
    finally { state.saving = false; setBusy(form, false); }
  });
  $('#detail-content').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target.closest('[data-action]'); if (!form || state.saving) return;
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.action === 'reassign') {
      const next = state.users.find(user => user.userId === data.technicianId);
      if (state.user?.role !== 'ADMINISTRATOR' || !state.detail || !window.ITSMReassignment.eligible(next, state.detail.technicianId)) { fieldError('#detail-error', 'Choose another available technician.'); return; }
      state.reassignment = { incidentId: state.detail.incidentId, technicianId: next.userId, expectedTechnicianId: state.detail.technicianId, expectedStatus: state.detail.status };
      $('#reassign-ticket').textContent = `${state.detail.incidentId} · ${state.detail.title}`;
      $('#reassign-from').textContent = technicianWithId(state.detail.technicianId); $('#reassign-to').textContent = technicianWithId(next.userId);
      $('#reassign-warning').textContent = window.ITSMReassignment.warning(state.detail, next);
      fieldError('#reassign-error', ''); $('#reassign-dialog').showModal(); return;
    }
    if ('question' in data && !data.question.trim()) { fieldError('#detail-error', 'Please enter a question for the employee.'); return; }
    if ('notes' in data && !data.notes.trim()) { fieldError('#detail-error', 'Please enter notes before submitting.'); return; }
    const id = state.selected; state.saving = true; fieldError('#detail-error', '');
      $('#detail-content').querySelectorAll('form').forEach(f => setBusy(f, true));
    $('#detail-dialog [data-close]').disabled = true;
    try {
      const row = await api.request(`/incidents/${encodeURIComponent(id)}/${form.dataset.action}`, { method: 'POST', data });
      state.detail = row; $('#detail-content').innerHTML = detailMarkup(row);
      if (form.dataset.action === 'assign') {
        $('#assigned-technician-confirmation')?.focus();
        notice(`${row.incidentId} assigned to ${technicianWithId(row.technicianId)}.`);
      } else {
        $('#actions-heading').focus({ preventScroll: true });
        notice(`${row.incidentId}: ${actionNames[form.dataset.action]} completed.`);
      }
      await refresh();
    } catch (error) { authError(error, '#detail-error'); }
    finally { state.saving = false; $('#detail-content').querySelectorAll('form').forEach(f => setBusy(f, false)); $('#detail-dialog [data-close]').disabled = false; }
  });
  $('#detail-content').addEventListener('change', event => {
    const form = event.target.closest('[data-action="reassign"]');
    if (form && event.target.name === 'technicianId' && event.target.value && !state.saving) form.requestSubmit();
  });
  $('#reassign-confirm-form').addEventListener('submit', async event => {
    event.preventDefault(); const pending = state.reassignment;
    if (state.saving || !pending || state.user?.role !== 'ADMINISTRATOR' || state.selected !== pending.incidentId || !$('#detail-dialog').open) return;
    state.saving = true; const form = event.currentTarget; setBusy(form, true); fieldError('#reassign-error', '');
    $('#detail-dialog [data-close]').disabled = true;
    try {
      const row = await api.request(`/incidents/${encodeURIComponent(pending.incidentId)}/reassign`, { method: 'POST', data: pending });
      state.detail = row; $('#reassign-dialog').close(); $('#detail-content').innerHTML = detailMarkup(row);
      $('#assigned-technician-confirmation')?.focus(); notice(`${row.incidentId} reassigned to ${technicianWithId(row.technicianId)}.`);
      await refresh();
    } catch (error) { authError(error, '#reassign-error'); }
    finally { state.saving = false; setBusy(form, false); $('#detail-dialog [data-close]').disabled = false; }
  });
  $('#reassign-dialog').addEventListener('cancel', event => { if (state.saving) event.preventDefault(); });
  $('#reassign-dialog').addEventListener('close', () => { state.reassignment = null; });
  const detailDialog = $('#detail-dialog');
  let backdropPointer = null;
  function isDetailBackdrop(event) {
    const bounds = detailDialog.getBoundingClientRect();
    return event.target === detailDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }
  detailDialog.addEventListener('pointerdown', event => {
    backdropPointer = event.isPrimary && event.button === 0 && isDetailBackdrop(event) ? event.pointerId : null;
  });
  detailDialog.addEventListener('pointerup', event => {
    const dismiss = backdropPointer === event.pointerId && isDetailBackdrop(event);
    backdropPointer = null;
    if (dismiss && !state.saving && !$('#reassign-dialog').open) closeDetailPanel();
  });
  detailDialog.addEventListener('pointercancel', () => { backdropPointer = null; });
  let detailClosing = false;
  function closeDetailPanel() {
    if (state.saving || detailClosing || !detailDialog.open) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { detailDialog.close(); return; }
    detailClosing = true; detailDialog.classList.add('panel-closing');
    setTimeout(() => { detailDialog.close(); detailDialog.classList.remove('panel-closing'); detailClosing = false; }, 200);
  }
  window.closeIncidentPanel = closeDetailPanel;
  detailDialog.addEventListener('cancel', event => { event.preventDefault(); closeDetailPanel(); });
  $('#create-dialog').addEventListener('cancel', event => { if (state.saving) event.preventDefault(); });
  $('#detail-dialog').addEventListener('close', () => { state.detailVersion++; state.selected = null; });
  $('#refresh-detail').addEventListener('click', async () => {
    if (state.saving || !state.selected) return;
    const id = state.selected;
    await refresh();
    if (state.user && $('#detail-dialog').open) await openDetail(id);
  });
  $('#incident-rows').addEventListener('click', event => { const target = event.target.closest('[data-open]'); if (target) openDetail(target.dataset.open); });
  $('#detail-content').addEventListener('click', event => { const target = event.target.closest('[data-open]'); if (target) openDetail(target.dataset.open); });
  $('#incident-filters').addEventListener('submit', event => event.preventDefault());
  $('#incident-filters').addEventListener('input', renderTable);
  $('#incident-filters').addEventListener('reset', () => setTimeout(renderTable, 0));
  $('#incident-search').addEventListener('input', renderTable);
  $('#incident-sort').addEventListener('change', renderTable);
  $('#sort-incident-id').addEventListener('click', () => { $('#incident-sort').value = $('#incident-sort').value === 'id-asc' ? 'id-desc' : 'id-asc'; renderTable(); });
  $('#refresh-incidents').addEventListener('click', async () => {
    notice(''); await refresh(); if (state.selected && $('#detail-dialog').open && !state.saving) await openDetail(state.selected);
  });
  $('#escalate-incidents').addEventListener('click', async () => {
    const button = $('#escalate-incidents'); button.disabled = true;
    try { const result = await api.request('/escalate', { method: 'POST' }); notice(`${result.count} incident(s) escalated for SLA breaches.`); await refresh(); }
    catch (error) { authError(error); }
    finally { button.disabled = false; }
  });
  $('#incident-notifications').addEventListener('click', () => selectSection('Notifications'));
  document.addEventListener('sectionchange', event => { state.section = event.detail; updateAccount(); });
  document.addEventListener('sessionexpired', () => authError({ status: 401 }));
  document.addEventListener('profileupdated', event => { state.user = event.detail; updateAccount(); refresh(); });
  document.addEventListener('accountschanged', () => { if (state.user) refresh(); });
  document.addEventListener('technicianschanged', () => { if (state.user) refresh(); });
  document.addEventListener('openincident', async event => {
    selectSection('Incidents');
    await refresh();
    if (state.user) await openDetail(event.detail);
  });
  async function boot() {
    updateAccount();
    try { state.user = await api.request('/session'); updateAccount(); selectSection('Overview'); document.documentElement.classList.remove('auth-check'); await refresh(); }
    catch (error) { signOutView(error.status === 401 ? '' : 'connection'); }
  }
  // Wait until all deferred page modules have registered their section listeners.
  document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
