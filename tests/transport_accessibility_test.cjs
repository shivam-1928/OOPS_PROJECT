const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/api.js'), 'utf8');
function transport(fetch, protocol = 'http:') {
  const context = { window: {}, location: { protocol }, fetch, AbortController, URLSearchParams, setTimeout, clearTimeout, TypeError };
  vm.runInNewContext(source, context);
  return context.window.ITSMApi;
}
function response(status, result, invalid = false) {
  return { status, ok: status >= 200 && status < 300, json: async () => { if (invalid) throw new SyntaxError('Unexpected token <'); return result; } };
}
async function failure(fn, message, status) {
  let error;
  try { await fn(); } catch (caught) { error = caught; }
  assert.ok(error, 'Expected request rejection'); checks++;
  assert.match(error.message, message); checks++;
  if (status !== undefined) check(error.status, status);
  return error;
}
function luminance(hex) {
  const values = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) { const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y); return (high + 0.05) / (low + 0.05); }
(async () => {
  let captured;
  const api = transport(async (url, options) => { captured = { url, options }; return response(200, { ok: true }); });
  check(await api.request('/incidents'), { ok: true });
  check(captured.url, '/api/incidents');
  check(captured.options.credentials, 'same-origin');
  check(captured.options.method, 'GET');
  await api.request('/incidents', { method: 'POST', data: { title: 'Email & access', description: 'A+B\n✓' } });
  check(new URLSearchParams(captured.options.body).get('description'), 'A+B\n✓');
  check(new URLSearchParams(captured.options.body).get('title'), 'Email & access');
  await failure(() => transport(async () => response(403, { error: 'Not assigned to you.' })).request('/incidents/INC1/resolve', { method: 'POST' }), /Not assigned/, 403);
  await failure(() => transport(async () => response(500, null)).request('/incidents'), /Request failed \(500\)/, 500);
  await failure(() => transport(async () => response(401, null, true)).request('/session'), /Request failed \(401\)/, 401);
  await failure(() => transport(async () => response(200, null, true)).request('/incidents'), /invalid response/, 200);
  await failure(() => transport(async () => { throw new TypeError('fetch failed'); }).request('/incidents'), /Cannot reach the Java server/);
  await failure(() => transport(async () => { throw new Error('Must not fetch'); }, 'file:').request('/incidents'), /Start the Java web server/);
  const canceled = new AbortController(); canceled.abort();
  const cancelError = await failure(() => transport(async (_, options) => {
    check(options.signal.aborted, true);
    const error = new Error('aborted'); error.name = 'AbortError'; throw error;
  }).request('/incidents', { signal: canceled.signal }), /canceled/);
  check(cancelError.name, 'AbortError');
  let requests = 0;
  await failure(() => transport(async () => { requests++; const error = new Error('aborted'); error.name = 'AbortError'; throw error; }).request('/incidents', { method: 'POST' }), /timed out.*Refresh before retrying/);
  check(requests, 1); // Never replay a potentially committed write.
  const css = fs.readFileSync(path.join(root, 'frontend/styles.css'), 'utf8');
  for (let p = 1; p <= 4; p++) {
    const declarations = css.match(new RegExp('\\.priority-p' + p + '\\{([^}]+)\\}'))[1];
    const background = declarations.match(/background:(#[0-9a-fA-F]{6})/)[1];
    const foreground = declarations.match(/(?:^|;)color:(#[0-9a-fA-F]{6})/)[1];
    assert.ok(contrast(background, foreground) >= 4.5, `P${p} text must meet 4.5:1 contrast`); checks++;
  }
  assert.ok(contrast('#262626', '#fff8f0') >= 3, 'Main focus outline contrast'); checks++;
  assert.ok(contrast('#acbfa4', '#262626') >= 3, 'Sidebar focus outline contrast'); checks++;
  console.log(`PASS: ${checks} transport, error-recovery and text-contrast assertions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
