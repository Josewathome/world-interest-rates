import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getAllRates } from "../db/index.js";
import { requireBrowserOrigin } from "../middleware/apiKeyAuth.js";
import { requireValidDashboardCookie } from "../middleware/dashboardToken.js";

const router = Router();

// Reads from our own cache (never touches upstream sources per-request) —
// this is what the dashboard page itself calls. Deliberately NOT meant to
// double as a free version of the keyed API, so it's layered:
//   1. requireBrowserOrigin — must look like a same-origin browser request
//   2. a short rate limit — a real dashboard tab only needs a poll a minute
//   3. requireValidDashboardCookie — must carry the signed, httpOnly cookie
//      set on page load (server.js's issueCookie), not expired
// The path and field names are deliberately unremarkable rather than
// self-describing ("rates", "token") — not because that stops anyone
// determined, but because a name like /rates?token=... is an instruction
// manual for whoever's watching DevTools, and there's no reason to hand
// that out for free. None of this is unbreakable: see the comments in
// apiKeyAuth.js and dashboardToken.js for exactly what it does and doesn't
// stop. Anyone who wants this data programmatically has a real, supported
// path: the keyed /api/v1/rates.
router.use(requireBrowserOrigin);
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

router.get("/f", requireValidDashboardCookie, async (req, res, next) => {
  try {
    res.json({ d: await getAllRates() });
  } catch (err) {
    next(err);
  }
});

export default router;
