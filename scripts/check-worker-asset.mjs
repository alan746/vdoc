import assert from 'node:assert/strict';

// Only retry timeouts of idempotent static-asset GETs. HTTP failures and empty
// responses are deployment defects and must fail the smoke check immediately.
export async function checkWorkerAsset(url, {
  timeoutMs = 30_000,
  attempts = 2,
  log = console.log,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    const started = Date.now();
    log(`CHECK ${url.pathname} (attempt ${attempt}/${attempts}, timeout ${timeoutMs}ms)`);
    try {
      const response = await fetch(url, { signal });
      if (response.status !== 200) {
        await response.body?.cancel();
        assert.fail(`${url.pathname} must load: HTTP ${response.status}`);
      }
      const bytes = (await response.arrayBuffer()).byteLength;
      assert.ok(bytes > 0, `${url.pathname} must not be empty`);
      log(`PASS ${url.pathname}: ${bytes} bytes in ${Date.now() - started}ms`);
      return;
    } catch (error) {
      if (signal.aborted && ['TimeoutError', 'AbortError'].includes(error?.name) && attempt < attempts) {
        log(`RETRY ${url.pathname}: request timed out after ${timeoutMs}ms`);
        continue;
      }
      throw new Error(`Static asset check failed: ${url.pathname} (attempt ${attempt}/${attempts}, ${Date.now() - started}ms): ${error.message}`, { cause: error });
    }
  }
}
