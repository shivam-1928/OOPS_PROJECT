(() => {
  'use strict';
  function filterUsers(rows, filters = {}, query = '') {
    const search = query.trim().toLowerCase();
    return rows.filter(row => (!filters.role || row.role === filters.role) && (!filters.active || String(row.active) === filters.active))
      .filter(row => !search || `${row.userId} ${row.name} ${row.username} ${row.email} ${row.department || ''}`.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId, undefined, { numeric: true }));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { filterUsers };
  if (typeof document === 'undefined') return;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = value => String(value).toLowerCase().replace(/^./, c => c.toUpperCase());
  const state = { user: window.ITSMCurrentUser || null, section: 'Incidents', rows: [], version: 0, loading: false, saving: false, target: null, fresh: false };
  function message(id, text) { $(id).textContent = text; $(id).hidden = !text; }
  function busy(form, value) { form.setAttribute('aria-busy', String(value)); form.querySelectorAll('button,input,select').forEach(control => control.disabled = value); }
  function failure(error, target) {
    if (error.status === 401) document.dispatchEvent(new CustomEvent('sessionexpired'));
    else message(target, error.message);
  }
  function controls() {
    $('#profile-picture-file').disabled = !state.user || state.loading || state.saving;
    $('#remove-profile-picture').disabled = state.loading || state.saving;
    $('#password-toggle').disabled = !state.user || state.loading || state.saving;
    $('#users-nav').hidden = state.user?.role !== 'ADMINISTRATOR';
    $('#refresh-users').disabled = state.loading || state.saving || state.user?.role !== 'ADMINISTRATOR';
    $('#users-register').setAttribute('aria-busy', String(state.loading));
    $('#profile-edit-form button[type="submit"]').disabled = !state.user || state.loading || state.saving;
    $('#password-edit-form button').disabled = !state.user || state.loading || state.saving;
  }
  function fillProfile() {
    const form = $('#profile-edit-form'), user = state.user;
    for (const key of ['name', 'username', 'email', 'department', 'phone', 'profilePicture']) form.elements[key].value = user?.[key] || '';
    updatePicturePreview();
    $('#profile-department-label').hidden = user?.role !== 'EMPLOYEE';
    form.elements.department.required = user?.role === 'EMPLOYEE'; form.elements.department.disabled = user?.role !== 'EMPLOYEE';
    $('#account-identity').textContent = user ? `${user.userId} · ${human(user.role)} · ${user.active ? 'Active account' : 'Inactive account'}` : '';
  }
  async function loadProfile() {
    if (!state.user) return;
    const version = ++state.version; state.loading = true; controls();
    try {
      const user = await window.ITSMApi.request('/session');
      if (version !== state.version) return;
      state.user = user; fillProfile();
    } catch (error) { if (version === state.version) failure(error, '#profile-edit-error'); }
    finally { if (version === state.version) { state.loading = false; controls(); } }
  }
  function renderUsers() {
    const filters = Object.fromEntries(new FormData($('#users-filters')));
    const rows = filterUsers(state.rows, filters, $('#users-search').value);
    $('#users-total').textContent = state.fresh || state.rows.length ? state.rows.length : '—';
    $('#users-active').textContent = state.fresh || state.rows.length ? state.rows.filter(user => user.active).length : '—';
    $('#users-inactive').textContent = state.fresh || state.rows.length ? state.rows.filter(user => !user.active).length : '—';
    $('#users-rows').innerHTML = rows.map(user => `<tr><td><strong>${escape(user.name)}</strong><span class="row-secondary">${escape(user.userId)} · ${escape(user.username)}</span></td><td>${escape(human(user.role))}</td><td>${escape(user.email)}${user.department ? `<span class="row-secondary">${escape(user.department)}</span>` : ''}</td><td><span class="status ${user.active ? '' : 'neutral'}">${user.active ? 'Active' : 'Inactive'}</span></td><td><button class="secondary-button" data-account-id="${escape(user.userId)}" ${!state.fresh || state.loading || state.saving || user.active && user.deactivationReason ? 'disabled' : ''}>${user.active ? 'Deactivate' : 'Activate'}</button>${user.active && user.deactivationReason ? `<span class="row-secondary account-status-reason"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none"/></svg><span>${escape(user.deactivationReason)}</span></span>` : ''}</td></tr>`).join('');
    $('#users-count').textContent = `${rows.length} of ${state.rows.length} users`;
    $('#users-empty').hidden = rows.length > 0;
    $('#users-empty').textContent = state.loading ? 'Loading users…' : !state.fresh ? 'Unable to load users. Use Refresh to retry.' : 'No users match these filters.';
    controls();
  }
  async function loadUsers() {
    if (state.user?.role !== 'ADMINISTRATOR' || state.loading) return;
    const version = ++state.version; state.loading = true; state.fresh = false; renderUsers();
    try {
      const result = await window.ITSMApi.request('/users');
      if (version !== state.version) return;
      state.rows = result.users; state.fresh = true; message('#users-notice', '');
    } catch (error) { if (version === state.version) failure(error, '#users-notice'); }
    finally { if (version === state.version) { state.loading = false; renderUsers(); } }
  }
  $('#open-profile-settings').addEventListener('click', () => { closeProfile(); selectSection('Profile & account'); $('#main').focus(); });
  function updatePicturePreview() {
    const value = $('#profile-edit-form').elements.profilePicture.value;
    const preview = $('#profile-picture-preview');
    preview.hidden = !value;
    if (value) preview.src = value; else preview.removeAttribute('src');
    $('#remove-profile-picture').hidden = !value;
  }
  let pictureVersion = 0;
  $('#profile-picture-file').addEventListener('change', async event => {
    const file = event.target.files[0], version = ++pictureVersion;
    if (!file) return;
    const identity = state.user?.userId;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { message('#profile-edit-error', 'Choose a JPG, PNG or WebP image up to 5 MB.'); event.target.value = ''; return; }
    state.loading = true; controls();
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff8f0'; context.fillRect(0, 0, 160, 160);
      const size = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width-size)/2, (bitmap.height-size)/2, size, size, 0, 0, 160, 160);
      let picture = canvas.toDataURL('image/jpeg', .8);
      if (picture.length > 24000) picture = canvas.toDataURL('image/jpeg', .45);
      if (picture.length > 24000) throw new Error('Please choose a simpler or smaller image.');
      if (version !== pictureVersion || state.user?.userId !== identity) return;
      $('#profile-edit-form').elements.profilePicture.value = picture; updatePicturePreview(); message('#profile-edit-error', '');
    } catch (error) { if (version === pictureVersion && state.user?.userId === identity) message('#profile-edit-error', error.message || 'Unable to read this image. Try another file.'); }
    finally { bitmap?.close(); if (version === pictureVersion) { state.loading = false; controls(); } }
  });
  $('#remove-profile-picture').addEventListener('click', () => { pictureVersion++; $('#profile-edit-form').elements.profilePicture.value = ''; $('#profile-picture-file').value = ''; updatePicturePreview(); });
  function hidePassword() { $('#password-fields').hidden = true; $('#password-toggle').setAttribute('aria-expanded', 'false'); $('#password-edit-form').reset(); }
  $('#password-toggle').addEventListener('click', () => {
    const expanded = $('#password-fields').hidden; $('#password-fields').hidden = !expanded; $('#password-toggle').setAttribute('aria-expanded', String(expanded));
    if (expanded) $('#password-edit-form input').focus(); else $('#password-edit-form').reset();
  });
  $('#profile-edit-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.saving || state.loading) return;
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    if (['name', 'username', 'email', ...(state.user?.role === 'EMPLOYEE' ? ['department'] : [])].some(key => !data[key]?.trim())) { message('#profile-edit-error', 'Please complete every field.'); return; }
    message('#profile-edit-error', ''); message('#account-feedback', ''); state.saving = true; busy(form, true); controls();
    const identity = state.user?.userId;
    try {
      const user = await window.ITSMApi.request('/profile', { method: 'POST', data });
      if (state.user?.userId !== identity) return;
      state.user = user; fillProfile(); message('#account-feedback', 'Profile updated. Use your current username the next time you sign in.');
      document.dispatchEvent(new CustomEvent('profileupdated', { detail: user }));
    } catch (error) { if (state.user?.userId === identity) failure(error, '#profile-edit-error'); }
    finally { state.saving = false; busy(form, false); form.elements.department.disabled = state.user?.role !== 'EMPLOYEE'; controls(); }
  });
  $('#password-edit-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.saving || state.loading) return;
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    if (data.newPassword !== data.confirmPassword) { message('#password-edit-error', 'New passwords do not match.'); return; }
    message('#password-edit-error', ''); message('#account-feedback', ''); state.saving = true; busy(form, true); controls();
    const identity = state.user?.userId;
    try {
      await window.ITSMApi.request('/profile/password', { method: 'POST', data: { currentPassword: data.currentPassword, newPassword: data.newPassword } });
      if (state.user?.userId === identity) { form.reset(); message('#account-feedback', 'Password changed. Your other signed-in sessions have ended.'); }
    } catch (error) { if (state.user?.userId === identity) failure(error, '#password-edit-error'); }
    finally { state.saving = false; busy(form, false); controls(); }
  });
  $('#users-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-account-id]'); if (!button || !state.fresh || state.loading || state.saving) return;
    state.target = state.rows.find(user => user.userId === button.dataset.accountId); if (!state.target) return;
    const user = state.target;
    $('#account-status-title').textContent = `${user.active ? 'Deactivate' : 'Activate'} account`;
    $('#account-status-description').textContent = `${user.name} · ${user.userId}. ${user.active ? 'This ends their current sessions and prevents sign-in. Existing records remain. You can activate the account again later.' : 'This restores sign-in access. Their previous sessions remain signed out.'}`;
    $('#confirm-account-status').textContent = user.active ? 'Deactivate account' : 'Activate account';
    message('#account-status-error', ''); $('#account-status-dialog').showModal();
  });
  $('#account-status-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.saving || !state.target) return;
    const target = state.target, form = event.currentTarget, identity = state.user?.userId;
    state.saving = true; busy(form, true); controls();
    try {
      await window.ITSMApi.request(`/users/${encodeURIComponent(target.userId)}/active`, { method: 'POST', data: { active: String(!target.active) } });
      if (state.user?.userId !== identity) return;
      $('#account-status-dialog').close(); document.dispatchEvent(new CustomEvent('accountschanged'));
      await loadUsers(); message('#users-notice', `${target.name}'s account is now ${target.active ? 'inactive' : 'active'}.`);
    } catch (error) { if (state.user?.userId === identity) failure(error, '#account-status-error'); }
    finally { state.saving = false; busy(form, false); renderUsers(); }
  });
  $('#account-status-dialog').addEventListener('cancel', event => { if (state.saving) event.preventDefault(); });
  $('#refresh-users').addEventListener('click', loadUsers);
  $('#users-filters').addEventListener('submit', event => event.preventDefault());
  $('#users-filters').addEventListener('change', renderUsers);
  $('#users-filters').addEventListener('reset', () => setTimeout(renderUsers, 0));
  $('#users-search').addEventListener('input', renderUsers);
  document.addEventListener('sessionchange', event => {
    const changed = state.user?.userId !== event.detail?.userId; state.user = event.detail;
    if (changed || !state.user) {
      pictureVersion++; hidePassword(); state.version++; state.loading = false; state.rows = []; state.fresh = false; state.target = null;
      $('#profile-edit-form').reset(); $('#password-edit-form').reset(); $('#users-filters').reset(); $('#users-search').value = '';
      message('#account-feedback', ''); message('#profile-edit-error', ''); message('#password-edit-error', ''); message('#users-notice', '');
      $('#account-status-dialog').close(); fillProfile(); renderUsers();
    }
    controls();
  });
  document.addEventListener('sectionchange', event => {
    pictureVersion++; hidePassword(); state.version++; state.loading = false; state.section = event.detail; controls();
    if (state.section === 'Users') {
      if (state.user?.role !== 'ADMINISTRATOR') { selectSection('Overview'); return; }
      loadUsers();
    }
    if (state.section === 'Profile & account') { message('#account-feedback', ''); message('#profile-edit-error', ''); message('#password-edit-error', ''); $('#password-edit-form').reset(); loadProfile(); }
    else $('#password-edit-form').reset();
  });
  controls();
})();
