import { Router } from "express";
import { requireSyncSecret } from "../middleware/apiKeyAuth.js";
import { runSync } from "../sync/index.js";
import { getRecentSyncLog } from "../db/index.js";

const router = Router();

// Called by an external free scheduler (e.g. cron-job.org) hitting this
// server every 15-30 minutes. This both wakes a sleeping free-tier host and
// triggers the actual data refresh, so we don't depend on in-process cron
// surviving restarts/spin-downs.
router.post("/sync", requireSyncSecret, async (req, res, next) => {
  try {
    const summary = await runSync();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get("/sync-log", requireSyncSecret, async (req, res, next) => {
  try {
    res.json({ log: await getRecentSyncLog() });
  } catch (err) {
    next(err);
  }
});

export default router;
