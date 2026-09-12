import crypto from "node:crypto";

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getValidKeys() {
  return (process.env.API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Protects the public developer-facing API (/api/v1/*). Keys are plain
// strings in the API_KEYS env var (comma-separated) — fine for a small
// number of hand-issued keys; move to a hashed DB-backed table if you need
// self-serve key issuance/revocation later.
export function requireApiKey(req, res, next) {
  const provided = req.header("x-api-key");
  const validKeys = getValidKeys();

  if (!provided || !validKeys.some((k) => timingSafeEqual(k, provided))) {
    return res.status(401).json({ error: "Missing or invalid API key. Pass it in the X-Api-Key header." });
  }
  next();
}

// Protects the internal sync-trigger endpoint (separate secret from public
// API keys, meant only for your own cron pinger).
export function requireSyncSecret(req, res, next) {
  const provided = req.header("x-sync-secret");
  const expected = process.env.SYNC_SECRET;

  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    return res.status(401).json({ error: "Missing or invalid sync secret." });
  }
  next();
}

// Restricts /public/rates to actual browser page-loads of this site, not a
// copy-pasted URL hit directly by curl/a script/another site's server.
//
// Real limitation, stated plainly: this is a speed bump, not a lock. Origin
// and Referer are ordinary request headers — anyone willing to write a
// script that sets them can still pass this check, and nothing can stop a
// human from reading numbers off a public page and retyping them elsewhere.
// What this DOES stop is exactly the casual case that prompted it: someone
// copying the URL straight out of DevTools and hitting it from curl/Postman/
// a cron job with no extra effort, which is what "quietly becomes a free
// substitute for the keyed API" actually looks like in practice. Anyone who
// wants the data programmatically has a real path: /api/v1/rates with a key.
export function requireBrowserOrigin(req, res, next) {
  const origin = req.headers.origin || req.headers.referer;
  let originHost;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }

  if (!originHost || originHost !== req.headers.host) {
    return res.status(403).json({
      error: "This endpoint only serves the dashboard page itself. For programmatic access, use /api/v1/rates with an API key.",
    });
  }
  next();
}
