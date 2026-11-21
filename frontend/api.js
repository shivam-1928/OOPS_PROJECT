/* Same-origin transport to the Java web adapter. Never substitutes local demo data. */
window.ITSMApi = {
  async request(path, { method = 'GET', data, signal } = {}) {
    if (location.protocol === 'file:') throw new Error('Start the Java web server and open http://127.0.0.1:8080 to use incidents.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await fetch(`/api${path}`, {
        method, credentials: 'same-origin', signal: controller.signal,
        ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams(data || {}) } : {})
      });
      let result;
      try { result = await response.json(); }
      catch (failure) {
        if (failure.name === 'AbortError') throw failure;
        const error = new Error(response.ok
          ? 'The server returned an invalid response. Refresh and try again.'
          : `Request failed (${response.status}). Refresh and try again.`);
        error.status = response.status;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(typeof result?.error === 'string' ? result.error : `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        const failure = new Error(signal?.aborted ? 'The request was canceled.' : 'The request timed out. Refresh before retrying a change to check whether it was saved.');
        if (signal?.aborted) failure.name = 'AbortError';
        throw failure;
      }
      if (error instanceof TypeError) throw new Error('Cannot reach the Java server. Check it is running, then retry.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
};
