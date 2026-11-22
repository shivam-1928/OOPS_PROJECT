// Shared shell behavior. Incident workflows live in incidents.js.
const sidebar = document.querySelector('.sidebar');
const toggle = document.querySelector('.brand');
const items = [...document.querySelectorAll('[data-section]')];
toggle.addEventListener('click', () => {
  const pinned = sidebar.classList.toggle('pinned');
  toggle.setAttribute('aria-expanded', String(pinned));
  toggle.setAttribute('aria-label', pinned ? 'Release expanded navigation' : 'Keep navigation expanded');
});
function selectSection(section) {
  items.forEach(item => {
    const active = item.dataset.section === section;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const isIncidents = section === 'Incidents';
  const isOverview = section === 'Overview';
  const isAccount = section === 'Profile & account';
  const isUsers = section === 'Users';
  const isTechnicians = section === 'Technicians';
  const isSLA = section === 'SLA monitoring';
  const isReports = section === 'Reports';
  const isAudit = section === 'Audit trail';
  const isNotifications = section === 'Notifications';
  document.querySelector('#page-title').textContent = section;
  document.querySelector('#page-title').classList.toggle('incident-heading', isIncidents || isTechnicians);
  document.querySelector('#breadcrumb-current').textContent = section;
  document.querySelector('#incidents-workspace').hidden = !isIncidents;
  document.querySelector('#overview-workspace').hidden = !isOverview;
  document.querySelector('#account-workspace').hidden = !isAccount;
  document.querySelector('#users-workspace').hidden = !isUsers;
  document.querySelector('#technicians-workspace').hidden = !isTechnicians;
  document.querySelector('#sla-workspace').hidden = !isSLA;
  document.querySelector('#reports-workspace').hidden = !isReports;
  document.querySelector('#audit-workspace').hidden = !isAudit;
  document.querySelector('#notifications-workspace').hidden = !isNotifications;
  document.querySelector('#section-placeholder').hidden = isAccount || isUsers || isOverview || isIncidents || isTechnicians || isSLA || isReports || isAudit || isNotifications;
  document.querySelector('#notice').hidden = !isIncidents || !document.querySelector('#notice').textContent;
  document.querySelector('#placeholder-title').textContent = section;
  document.title = `${section} · Resolvr`;
  document.dispatchEvent(new CustomEvent('sectionchange', { detail: section }));
}
items.forEach(item => item.addEventListener('click', () => selectSection(item.dataset.section)));
document.querySelector('#back-to-incidents').addEventListener('click', () => {
  selectSection('Incidents'); document.querySelector('#main').focus();
});
const profileButton = document.querySelector('#profile-button');
const profilePanel = document.querySelector('#profile-panel');
function closeProfile() {
  profilePanel.hidden = true;
  profileButton.setAttribute('aria-expanded', 'false');
}
profileButton.addEventListener('click', () => {
  const open = profilePanel.hidden;
  profilePanel.hidden = !open;
  profileButton.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', event => {
  if (!event.target.closest('.profile-control')) closeProfile();
  const close = event.target.closest('[data-close]');
  if (close) { if (close.dataset.close === 'detail-dialog' && window.closeIncidentPanel) window.closeIncidentPanel(); else document.getElementById(close.dataset.close).close(); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!profilePanel.hidden) { closeProfile(); profileButton.focus(); return; }
  sidebar.classList.remove('pinned');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Keep navigation expanded');
  if (sidebar.contains(document.activeElement)) document.querySelector('#main').focus();
});
