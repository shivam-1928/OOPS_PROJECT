(() => {
  'use strict';
  const emptyState = () => ({ read: [], deleted: [], demos: [], order: 'latest' });
  function cleanState(value) {
    if (!value || typeof value !== 'object') return emptyState();
    return {
      read: [...new Set(Array.isArray(value.read) ? value.read.filter(id => typeof id === 'string') : [])],
      deleted: [...new Set(Array.isArray(value.deleted) ? value.deleted.filter(id => typeof id === 'string') : [])],
      demos: Array.isArray(value.demos) ? value.demos.filter(row => row && typeof row.id === 'string' && row.id.startsWith('demo:') && typeof row.message === 'string' && typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp))).map(row => ({ id: row.id, message: row.message, timestamp: row.timestamp })) : [],
      order: value.order === 'oldest' ? 'oldest' : 'latest'
    };
  }
  class NotificationStore {
    constructor(storage, key) { this.storage = storage; this.key = key; this.persistent = !!storage; this.data = emptyState(); this.reload(); }
    reload() {
      if (!this.persistent) return this.data;
      try {
        const serialized = this.storage.getItem(this.key);
        let value;
        try { value = JSON.parse(serialized); } catch { value = null; }
        this.data = cleanState(value);
      } catch { this.persistent = false; }
      return this.data;
    }
    commit(change) {
      const data = this.reload(); change(data); this.data = cleanState(data);
      if (this.persistent) {
        try { this.storage.setItem(this.key, JSON.stringify(this.data)); } catch { this.persistent = false; }
      }
      return this.data;
    }
  }
  function normalize(messages) {
    const occurrences = new Map();
    return messages.map((raw, index) => {
      const occurrence = occurrences.get(raw) || 0; occurrences.set(raw, occurrence + 1);
      const match = raw.match(/^(.*?) \| To: (.*?) \| ([\s\S]*)$/);
      const message = match ? match[3] : raw;
      const timestamp = match && Number.isFinite(Date.parse(match[1])) ? match[1] : null;
      const incidentId = message.match(/\bINC\d+\b/)?.[0] || null;
      const title = /has been created/i.test(message) ? 'Incident reported' : /has been assigned/i.test(message) ? 'Incident assigned' : /has been resolved/i.test(message) ? 'Incident resolved' : /has been escalated/i.test(message) ? 'Incident escalated' : /status is now/i.test(message) ? 'Incident status updated' : 'New notification';
      return { id: `server:${encodeURIComponent(raw)}:${occurrence}`, timestamp, message, incidentId, title: incidentId ? `${title} · ${incidentId}` : title, source: 'server', sequence: index };
    });
  }
  function inbox(serverMessages, data) {
    const deleted = new Set(data.deleted), read = new Set(data.read);
    const demos = data.demos.map((row, index) => ({ ...row, title: 'Test notification', source: 'demo', incidentId: null, sequence: serverMessages.length + index }));
    return [...serverMessages, ...demos].filter(row => !deleted.has(row.id)).map(row => ({ ...row, read: read.has(row.id) }))
      .sort((a, b) => (((a.timestamp ? Date.parse(a.timestamp) : 0) - (b.timestamp ? Date.parse(b.timestamp) : 0)) || a.sequence - b.sequence) * (data.order === 'oldest' ? 1 : -1));
  }
  const hasP1 = incidents => incidents.some(incident => incident.priority === 'P1');
  const dismissSwipe = (dx, dy, width) => dx <= -Math.max(48, Math.min(100, width * 0.28)) && Math.abs(dx) > Math.abs(dy) * 1.2;
  if (typeof module !== 'undefined' && module.exports) module.exports = { NotificationStore, cleanState, normalize, inbox, hasP1, dismissSwipe };
  if (typeof document === 'undefined') return;

  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { user: window.ITSMCurrentUser || null, section: 'Incidents', store: null, server: [], incidents: [], version: 0, loading: false, timer: null, updated: null, expanded: null, undo: null, context: null, gesture: null, queued: false, suppressClickUntil: 0, signature: null };
  const messages = () => state.store ? inbox(state.server, state.store.data) : [];
  const date = timestamp => timestamp ? new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
  const cardFor = id => [...$('#notification-items').querySelectorAll('[data-notification-id]')].find(card => card.dataset.notificationId === id);
  function focusNotification(id) { cardFor(id)?.querySelector('.notification-open').focus({ preventScroll: true }); }
  function feedback(message, undo = false) {
    $('#notification-feedback-text').textContent = message; $('#notification-feedback').hidden = !message;
    $('#undo-notification-delete').hidden = !undo;
  }
  function error(message) { $('#notifications-error').textContent = message; $('#notifications-error').hidden = !message; }
  function closeMenu(restoreFocus = false) {
    const id = state.context; state.context = null; $('#notification-context-menu').hidden = true;
    if (restoreFocus && id) focusNotification(id);
  }
  function controls() {
    const rows = messages(), unread = rows.filter(row => !row.read).length, p1 = !!state.user && hasP1(state.incidents);
    $('#notification-unread-dot').hidden = unread === 0;
    $('#notification-p1-hazard').hidden = !p1;
    $('#notification-hazard-explanation').hidden = !p1;
    $('#notifications-nav').setAttribute('aria-label', `Notifications${unread ? `, ${unread} unread` : ''}${p1 ? ', P1 incident present' : ''}`);
    $('#notifications-nav').title = `${unread} unread notification${unread === 1 ? '' : 's'}${p1 ? ' · P1 incident present' : ''}`;
    $('#notification-count').textContent = unread;
    $('#incident-notifications').setAttribute('aria-label', `Notifications, ${unread} unread`);
    $('#notifications-summary').textContent = state.user ? `${unread} unread · ${rows.length} notification${rows.length === 1 ? '' : 's'}` : 'Sign in to view your notifications.';
    $('#refresh-notifications').disabled = !state.user || state.loading;
    $('#test-notification').disabled = !state.user;
    $('#read-all-notifications').disabled = !state.user || unread === 0;
    $('#clear-notifications').disabled = !state.user || rows.length === 0;
    $('#notification-order').disabled = !state.user;
    $('#notification-inbox').setAttribute('aria-busy', String(state.loading));
  }
  function render(force = false) {
    controls();
    if (state.gesture) { state.queued = true; return; }
    const rows = messages();
    const signature = JSON.stringify([state.expanded, state.store?.data.order, rows.map(row => [row.id, row.read, row.message])]);
    if (!force && signature === state.signature) return;
    state.signature = signature;
    const focusedCard = document.activeElement?.closest('[data-notification-id]');
    const focusedId = focusedCard?.dataset.notificationId;
    const menuFocused = document.activeElement?.hasAttribute('data-notification-menu');
    closeMenu();
    $('#notification-items').innerHTML = rows.map((row, index) => {
      const expanded = state.expanded === row.id;
      const canOpenIncident = row.incidentId && state.incidents.some(incident => incident.incidentId === row.incidentId);
      const brief = row.message.length > 160 ? row.message.slice(0, 157) + '…' : row.message;
      return `<li class="notification-swipe-row"><span class="notification-swipe-delete" aria-hidden="true">Delete</span><div class="notification-card ${row.read ? '' : 'unread'}" data-notification-id="${escape(row.id)}"><button type="button" class="notification-open" aria-expanded="${expanded}" aria-controls="notification-detail-${index}"><span class="sr-only">${row.read ? 'Read' : 'Unread'} notification.</span><span class="notification-summary-line"><strong>${escape(row.title)}</strong><time ${row.timestamp ? `datetime="${escape(row.timestamp)}"` : ''}>${escape(date(row.timestamp))}</time></span>${!expanded ? `<span class="notification-brief">${escape(brief)}</span>` : ''}<span class="notification-source">${row.source === 'demo' ? 'Simulated notification' : 'In-app notification'}</span></button><button type="button" class="notification-options" data-notification-menu aria-haspopup="menu" aria-label="Actions for ${escape(row.title)}">⋯</button><div id="notification-detail-${index}" class="notification-expanded" ${expanded ? '' : 'hidden'}><p>${escape(row.message)}</p>${canOpenIncident ? `<button type="button" class="text-button" data-notification-incident="${escape(row.incidentId)}">View incident ${escape(row.incidentId)}</button>` : ''}</div></div></li>`;
    }).join('');
    $('#notification-empty').hidden = rows.length > 0;
    $('#notification-empty').textContent = !state.user ? 'Sign in to view your notifications.' : state.updated || state.store?.data.demos.length ? 'You’re all caught up. New notifications will appear here.' : 'No notifications yet. Refresh or send a test notification to try the inbox.';
    if (focusedId && cardFor(focusedId)) {
      if (menuFocused) cardFor(focusedId).querySelector('[data-notification-menu]').focus({ preventScroll: true });
      else focusNotification(focusedId);
    }
  }
  function commit(change) {
    if (!state.store) return;
    state.store.commit(change);
    $('#notification-order').value = state.store.data.order;
    if (!state.store.persistent) error('Browser storage is unavailable. Read status and dismissals will last for this session only.');
    render();
  }
  function resetUser(user) {
    clearTimeout(state.timer); state.timer = null; state.version++; state.loading = false;
    state.server = []; state.incidents = []; state.updated = null; state.expanded = null; state.undo = null; state.signature = null;
    state.queued = false;
    cancelGesture(); closeMenu(); feedback(''); error('');
    if (user) {
      let storage; try { storage = window.localStorage; } catch { storage = null; }
      state.store = new NotificationStore(storage, `itsm.notifications.v1:${user.userId}`);
      $('#notification-order').value = state.store.data.order;
      if (!state.store.persistent) error('Browser storage is unavailable. Read status and dismissals will last for this session only.');
    } else { state.store = null; $('#notification-order').value = 'latest'; }
    $('#notifications-sync').textContent = 'Not refreshed yet'; render(true);
  }
  function acceptSnapshot(result) {
    if (!Array.isArray(result.notifications) || result.notifications.some(message => typeof message !== 'string') || !Array.isArray(result.incidents)) throw new Error('The server returned incomplete notification data.');
    state.server = normalize(result.notifications); state.incidents = result.incidents; state.updated = new Date();
    $('#notifications-sync').textContent = `Last checked ${state.updated.toLocaleTimeString()} · checks every 30 seconds while the app is visible`;
    if (state.store?.persistent) error('');
    render();
  }
  function schedule() {
    clearTimeout(state.timer); state.timer = null;
    if (state.user && document.visibilityState === 'visible') state.timer = setTimeout(refresh, 30000);
  }
  async function refresh() {
    if (!state.user || state.loading) return;
    clearTimeout(state.timer); state.timer = null;
    const version = ++state.version; state.loading = true; controls();
    try {
      const result = await window.ITSMApi.request('/incidents');
      if (version !== state.version) return;
      acceptSnapshot(result);
    } catch (failure) {
      if (version !== state.version) return;
      if (failure.status === 401) { document.dispatchEvent(new CustomEvent('sessionexpired')); return; }
      error(failure.message);
      $('#notifications-sync').textContent = state.updated ? `Last checked ${state.updated.toLocaleTimeString()} · refresh failed, showing previous messages` : 'Cannot load notifications. Use Refresh to retry.';
    } finally { if (version === state.version) { state.loading = false; controls(); schedule(); } }
  }
  function deleteMessages(ids, label) {
    if (!ids.length) return;
    closeMenu(); state.undo = { ids };
    if (ids.includes(state.expanded)) state.expanded = null;
    commit(data => { data.deleted = [...new Set([...data.deleted, ...ids])]; });
    feedback(label, true);
  }
  function deleteOne(id) {
    const before = messages(), index = before.findIndex(row => row.id === id);
    if (index < 0) return;
    deleteMessages([id], 'Notification deleted.');
    const after = messages(); if (after.length) focusNotification(after[Math.min(index, after.length - 1)].id);
    else $('#test-notification').focus({ preventScroll: true });
  }
  function openMenu(id, x, y) {
    if (!messages().some(row => row.id === id)) return;
    closeMenu(); state.context = id;
    const menu = $('#notification-context-menu'); menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    $('#delete-notification-menu-item').focus({ preventScroll: true });
  }
  function cancelGesture() {
    const gesture = state.gesture; state.gesture = null;
    if (gesture) { gesture.card.classList.remove('dragging'); gesture.card.style.transform = ''; if (gesture.card.hasPointerCapture(gesture.pointerId)) gesture.card.releasePointerCapture(gesture.pointerId); }
  }
  function finishGesture(event, canceled = false) {
    const gesture = state.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const remove = !canceled && gesture.horizontal && dismissSwipe(gesture.dx, gesture.dy, gesture.card.offsetWidth);
    if (gesture.horizontal) state.suppressClickUntil = Date.now() + 500;
    cancelGesture();
    if (remove) deleteOne(gesture.id);
    else if (state.queued) setTimeout(() => render(), 0);
    state.queued = false;
  }
  const list = $('#notification-items');
  list.addEventListener('pointerdown', event => {
    const card = event.target.closest('[data-notification-id]');
    if (!card || event.button !== 0 || !event.isPrimary || event.target.closest('[data-notification-menu],[data-notification-incident]')) return;
    cancelGesture(); closeMenu();
    state.gesture = { id: card.dataset.notificationId, card, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, horizontal: false };
  });
  list.addEventListener('pointermove', event => {
    const gesture = state.gesture; if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.dx = event.clientX - gesture.x; gesture.dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx)) { cancelGesture(); return; }
      if (gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2) {
        gesture.horizontal = true; gesture.card.setPointerCapture(event.pointerId); gesture.card.classList.add('dragging');
      } else return;
    }
    event.preventDefault(); gesture.card.style.transform = `translateX(${Math.max(-gesture.card.offsetWidth, Math.min(0, gesture.dx))}px)`;
  });
  document.addEventListener('pointerup', event => finishGesture(event));
  document.addEventListener('pointercancel', event => finishGesture(event, true));
  list.addEventListener('lostpointercapture', event => { if (state.gesture) finishGesture(event, true); });
  list.addEventListener('click', event => {
    if (Date.now() < state.suppressClickUntil) { event.preventDefault(); return; }
    const card = event.target.closest('[data-notification-id]'); if (!card) return;
    const id = card.dataset.notificationId;
    if (event.target.closest('[data-notification-menu]')) { const rect = event.target.closest('button').getBoundingClientRect(); openMenu(id, rect.right - 170, rect.bottom + 4); return; }
    const incident = event.target.closest('[data-notification-incident]');
    if (incident) { document.dispatchEvent(new CustomEvent('openincident', { detail: incident.dataset.notificationIncident })); return; }
    if (event.target.closest('.notification-open')) {
      state.expanded = state.expanded === id ? null : id;
      commit(data => { data.read = [...new Set([...data.read, id])]; }); focusNotification(id);
    }
  });
  list.addEventListener('contextmenu', event => {
    const card = event.target.closest('[data-notification-id]'); if (!card) return;
    event.preventDefault(); cancelGesture(); openMenu(card.dataset.notificationId, event.clientX, event.clientY);
  });
  list.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      const card = event.target.closest('[data-notification-id]'); if (!card) return;
      event.preventDefault(); const rect = card.getBoundingClientRect(); openMenu(card.dataset.notificationId, rect.left + 24, rect.top + 48);
    }
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#notification-context-menu') && !event.target.closest('[data-notification-menu]')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (!state.context) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    else if (event.key === 'Tab') closeMenu();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); $('#delete-notification-menu-item').focus(); }
  });
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('scroll', () => closeMenu(), true);
  window.addEventListener('blur', () => { cancelGesture(); closeMenu(); if (state.queued) { state.queued = false; render(); } });
  $('#delete-notification-menu-item').addEventListener('click', () => { if (state.context) deleteOne(state.context); });
  $('#refresh-notifications').addEventListener('click', refresh);
  $('#notification-order').addEventListener('change', event => commit(data => { data.order = event.target.value; }));
  $('#read-all-notifications').addEventListener('click', () => { const ids = messages().map(row => row.id); commit(data => { data.read = [...new Set([...data.read, ...ids])]; }); feedback('All notifications marked as read.'); });
  $('#clear-notifications').addEventListener('click', () => { const ids = messages().map(row => row.id); deleteMessages(ids, `${ids.length} notification${ids.length === 1 ? '' : 's'} cleared.`); });
  $('#undo-notification-delete').addEventListener('click', () => {
    if (!state.undo) return;
    const ids = new Set(state.undo.ids); state.undo = null;
    commit(data => { data.deleted = data.deleted.filter(id => !ids.has(id)); }); feedback('Notifications restored.');
  });
  $('#test-notification').addEventListener('click', () => {
    if (!state.user) return;
    const row = { id: `demo:${crypto.randomUUID()}`, timestamp: new Date().toISOString(), message: 'This is a test notification for your service desk. Click to mark it as read, or try right-clicking or swiping left to delete it.' };
    commit(data => { data.demos.push(row); }); feedback('Test notification received.');
  });
  document.addEventListener('sessionchange', event => {
    const changed = state.user?.userId !== event.detail?.userId; state.user = event.detail;
    if (changed || !state.user) { resetUser(state.user); schedule(); }
    controls();
  });
  document.addEventListener('incidentsnapshot', event => {
    if (!state.user || event.detail.userId !== state.user.userId) return;
    state.version++; state.loading = false;
    try { acceptSnapshot(event.detail); } catch (failure) { error(failure.message); }
    controls(); schedule();
  });
  document.addEventListener('sectionchange', event => {
    state.section = event.detail; cancelGesture(); closeMenu();
    if (state.section === 'Notifications' && state.user) { render(); refresh(); }
  });
  document.addEventListener('visibilitychange', () => { clearTimeout(state.timer); state.timer = null; if (state.user && document.visibilityState === 'visible') refresh(); });
  window.addEventListener('storage', event => { if (state.store && (event.key === state.store.key || event.key === null)) { state.store.reload(); $('#notification-order').value = state.store.data.order; render(); } });
  if (state.user) resetUser(state.user);
  controls();
})();
