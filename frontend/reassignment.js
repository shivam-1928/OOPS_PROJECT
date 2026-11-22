(() => {
  'use strict';
  const categories = ['NETWORK', 'HARDWARE', 'SOFTWARE', 'EMAIL', 'ACCESS', 'OTHER'];
  const rank = skill => categories.includes(skill) ? categories.indexOf(skill) : categories.length;
  function groupTechnicians(users) {
    const groups = new Map();
    for (const technician of users.filter(user => user.role === 'TECHNICIAN')) {
      const skills = [...(technician.skills || [])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      const primary = skills[0] || 'NO_SKILLS';
      if (!groups.has(primary)) groups.set(primary, []);
      groups.get(primary).push(technician);
    }
    return [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([skill, technicians]) => ({ skill,
      technicians: technicians.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId, undefined, { numeric: true })) }));
  }
  const eligible = (technician, currentId) => technician?.role === 'TECHNICIAN' && technician.userId !== currentId && technician.active !== false && technician.available === true;
  function warning(incident, technician) {
    const mismatch = !technician.skills?.includes(incident.category);
    return 'The current technician will lose ownership and this ticket will return to Assigned. The new technician must acknowledge it. Previous work, questions and replies will remain, and SLA deadlines will not reset.'
      + (mismatch ? ` This technician does not list ${incident.category.toLowerCase()} as a skill. Confirm only if they are suitable for this work.` : '');
  }
  const views = { groupTechnicians, eligible, warning };
  if (typeof module !== 'undefined' && module.exports) module.exports = views;
  if (typeof window !== 'undefined') window.ITSMReassignment = views;
})();
