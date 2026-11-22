const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../frontend/auth.js'), 'utf8');
let checks = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); checks++; }
function harness(mode, data, request = async () => ({})) {
  const handlers = {}, nodes = {};
  const node = id => nodes[id] ||= { textContent: '', hidden: true };
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { value, disabled: false }]));
  const elements = Object.assign(Object.values(fields), fields);
  const form = { elements, reset() { for (const value of Object.values(fields)) value.value = ''; }, setAttribute() {}, addEventListener(name, handler) { handlers[name] = handler; } };
  const nav = [];
  vm.runInNewContext(source, { URLSearchParams, location: { search: '', replace: path => nav.push(path) }, window: { ITSMApi: { request } }, document: { querySelector(selector) { if (selector === '#signin-form') return mode === 'signin' ? form : null; if (selector === '#signup-form') return mode === 'signup' ? form : null; return node(selector); } }, FormData: class { constructor() { return Object.entries(fields).map(([key, field]) => [key, field.value]); } } });
  return { fields, nodes, nav, submit: () => handlers.submit({ preventDefault() {} }) };
}
(async () => {
  let requests = 0;
  const data = { name: 'Example Employee', username: 'example', email: 'example@local.test', department: 'Support', password: 'example-only', confirmPassword: 'example-only' };
  const signup = harness('signup', data, async (path, options) => { requests++; check(path, '/register'); check(options.data.password, 'example-only'); check('confirmPassword' in options.data, false); return { registered: true }; });
  await signup.submit();
  check(requests, 1); check(signup.nav, ['signin.html?registered=1']);
  check(signup.fields.password.value, ''); check(signup.fields.confirmPassword.value, '');
  const mismatch = harness('signup', { ...data, confirmPassword: 'different' }); await mismatch.submit();
  check(mismatch.nodes['#auth-error'].textContent, 'Passwords do not match.');
  const blank = harness('signup', { ...data, department: '  ' }); await blank.submit();
  check(blank.nodes['#auth-error'].textContent, 'Please complete every field.');
  const duplicate = harness('signup', data, async () => { throw Error('That username is already in use.'); });
  await duplicate.submit(); check(duplicate.nodes['#auth-error'].textContent, 'That username is already in use.'); check(duplicate.fields.password.value, ''); check(duplicate.fields.username.disabled, false); check(duplicate.nav, []);
  const signin = harness('signin', { username: ' employee ', password: 'existing-test-password' }, async (path, options) => { check(path, '/session'); check(options.data.username, 'employee'); return {}; });
  await signin.submit(); check(signin.nav, ['./index.html']); check(signin.fields.password.value, '');
  const failure = harness('signin', { username: 'employee', password: 'wrong' }, async () => { throw Error('Invalid username or password.'); });
  await failure.submit(); check(failure.nodes['#auth-error'].textContent, 'Invalid username or password.'); check(failure.fields.password.value, ''); check(failure.fields.username.disabled, false); check(failure.nav, []);
  const html = fs.readFileSync(require.resolve('../frontend/index.html'), 'utf8');
  check(html.includes('id="login-dialog"'), false);
  for (const page of ['signin', 'signup']) {
    const document = fs.readFileSync(require.resolve(`../frontend/${page}.html`), 'utf8');
    check(/<body\b[^>]*\bclass="[^"]*\bauth-page\b/.test(document), true); check(document.includes('class="sidebar"'), false);
  }
  console.log(`Authentication: ${checks} form and standalone-page assertions passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
