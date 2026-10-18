// GET a URL and return parsed JSON — but treat the ways a flaky public API
// can lie about success as failures, instead of letting them surface as
// cryptic parse errors three layers down:
//   - an HTML/XML page served with HTTP 200 (BCB's gateway does this when it
//     rejects a request: "Requisição inválida! / Bad request!")
//   - an error object served with HTTP 200 (BCB: {"erro": {...}})
//   - a hang (Node's fetch has no overall timeout by default, so one dead
//     host can stall an entire sync cycle for minutes)
// Every error names its source (`label`), so a log line like
// "BCB IPCA: expected JSON but got an HTML/XML page" says which feed broke —
// previously the raw SyntaxError didn't.
//
// Fast failures (bad body, 5xx, 429, dropped connection) are retried a
// couple of times. A timeout is NOT retried: a host that hung once will
// almost always hang again, and retrying would just double the wall time a
// sync spends waiting on it.
const DEFAULT_UA = "world-interest-rates/1.0 (+https://github.com/Josewathome/world-interest-rates)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FetchJsonError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

async function attemptOnce(url, { label, headers, timeoutMs, validate }) {
  let status;
  let text;
  try {
    // The abort signal covers reading the body too, not just the headers.
    const res = await fetch(url, {
      headers: { "User-Agent": DEFAULT_UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new FetchJsonError(`${label}: timed out after ${timeoutMs}ms`, false);
    }
    throw new FetchJsonError(`${label}: network error (${err.cause?.code || err.message})`, true);
  }

  if (status < 200 || status >= 300) {
    throw new FetchJsonError(`${label}: HTTP ${status}`, status >= 500 || status === 429);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const kind = text.trimStart().startsWith("<")
      ? "an HTML/XML page (gateway or WAF rejection, served with HTTP 200)"
      : "unparseable text";
    throw new FetchJsonError(`${label}: expected JSON but got ${kind}`, true);
  }

  const problem = validate?.(data);
  if (problem) throw new FetchJsonError(`${label}: ${problem}`, true);
  return data;
}

// `validate(data)` returns a problem description (string) if the parsed body
// isn't what the caller needs, or null/undefined if it's fine.
export async function fetchJson(url, { label, headers = {}, timeoutMs = 8000, retries = 2, validate } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    try {
      return await attemptOnce(url, { label, headers, timeoutMs, validate });
    } catch (err) {
      lastErr = err;
      if (err.retryable === false) break;
    }
  }
  throw lastErr;
}
