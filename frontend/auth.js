(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const signin = $('#signin-form'), signup = $('#signup-form');
  const error = message => { $('#auth-error').textContent = message; $('#auth-error').hidden = !message; };
  if (signin) {
    const greeting = $('#signin-greeting');
    if (greeting?.classList) {
      const fallbackGreeting = () => {
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
        return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
      };
      window.ITSMApi.request('/greeting').then(result => {
        greeting.textContent = ['Good morning', 'Good afternoon', 'Good evening'].includes(result.message) ? result.message : fallbackGreeting();
      }).catch(() => { greeting.textContent = fallbackGreeting(); }).finally(() => {
        greeting.classList.remove('greeting-pending'); greeting.classList.add('greeting-enter');
      });
    }
    const query = new URLSearchParams(location.search);
    const message = query.has('registered') ? 'Account created. Sign in to continue.' : query.has('expired') ? 'Your session ended. Please sign in again.' : query.has('connection') ? 'We could not connect to the service desk. Try signing in again.' : '';
    $('#auth-message').textContent = message; $('#auth-message').hidden = !message;
    signin.addEventListener('submit', async event => {
      event.preventDefault(); error('');
      const data = Object.fromEntries(new FormData(signin)); data.username = data.username.trim();
      if (!data.username || !data.password.trim()) { error('Enter your username and password.'); return; }
      const controls = [...signin.elements]; controls.forEach(control => control.disabled = true); signin.setAttribute('aria-busy', 'true');
      try { await window.ITSMApi.request('/session', { method: 'POST', data }); signin.reset(); location.replace('./'); }
      catch (failure) { error(failure.message); signin.elements.password.value = ''; }
      finally { controls.forEach(control => control.disabled = false); signin.setAttribute('aria-busy', 'false'); }
    });
  }
  if (signup) signup.addEventListener('submit', async event => {
    event.preventDefault(); error('');
    const data = Object.fromEntries(new FormData(signup));
    if (['name', 'username', 'email', 'department', 'password'].some(key => !data[key].trim())) { error('Please complete every field.'); return; }
    if (data.password !== data.confirmPassword) { error('Passwords do not match.'); return; }
    const controls = [...signup.elements]; controls.forEach(control => control.disabled = true); signup.setAttribute('aria-busy', 'true');
    try {
      const { confirmPassword, ...registration } = data;
      await window.ITSMApi.request('/register', { method: 'POST', data: registration });
      signup.reset(); location.replace('signin.html?registered=1');
    } catch (failure) { error(failure.message); }
    finally { signup.elements.password.value = ''; signup.elements.confirmPassword.value = ''; controls.forEach(control => control.disabled = false); signup.setAttribute('aria-busy', 'false'); }
  });
})();
