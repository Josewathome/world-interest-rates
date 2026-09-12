import crypto from "node:crypto";

// Ephemeral by default — regenerated every process boot, which conveniently
// invalidates every outstanding token on each restart/redeploy for free. Set
// DASHBOARD_TOKEN_SECRET explicitly only if you run multiple instances that
// need to validate each other's tokens.
const SECRET = process.env.DASHBOARD_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");

// Short enough that a captured cookie value is only useful briefly; slides
// forward on every successful poll (see refreshCookie below) so a real,
// continuously-open dashboard tab never has to reload the page to keep
// working, but a captured value stops working shortly after polling stops.
const TOKEN_TTL_MS = 90_000;
const COOKIE_NAME = "_d";

function sign(expiry) {
  return crypto.createHmac("sha256", SECRET).update(String(expiry)).digest("hex");
}

function makeToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  return `${expiresAt}.${sign(expiresAt)}`;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: TOKEN_TTL_MS,
  };
}

// Sets the signed cookie on an ordinary page load (index.html). No separate
// visible "give me a token" request — it just rides along on the page
// navigation the browser was already doing, in a header, not a JS-visible
// fetch call.
export function issueCookie(req, res, next) {
  if (req.method === "GET" && req.path === "/") {
    res.cookie(COOKIE_NAME, makeToken(), cookieOptions());
  }
  next();
}

function isValid(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const dot = token.indexOf(".");
  const expiry = Number(token.slice(0, dot));
  const providedSig = token.slice(dot + 1);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expectedSig = sign(expiry);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Gates the data endpoint: requires the cookie set by issueCookie, not
// expired, with a matching signature. Same honest limitation as before —
// this is a speed bump against "copy the request and replay it later," not
// a claim that the data is unreadable. On success, it also *renews* the
// cookie (sliding window) as an ordinary Set-Cookie on this same response,
// so a continuously-polling tab never needs a separate refresh call.
export function requireValidDashboardCookie(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!isValid(token)) {
    return res.status(403).json({ error: "Not available. This endpoint only serves the dashboard page." });
  }
  res.cookie(COOKIE_NAME, makeToken(), cookieOptions());
  next();
}
