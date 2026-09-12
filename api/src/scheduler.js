import cron from "node-cron";
import { runSync } from "./sync/index.js";

// In-process cron as a primary/local-dev scheduler. On a free host that
// spins down when idle this alone isn't reliable — pair it with the external
// pinger described in the README hitting POST /internal/sync.
export function startScheduler() {
  const schedule = process.env.SYNC_CRON || "*/30 * * * *"; // every 30 minutes
  cron.schedule(schedule, async () => {
    console.log(`[scheduler] running sync (${new Date().toISOString()})`);
    try {
      const summary = await runSync();
      console.log(`[scheduler] done: ${summary.totalUpdated} updated, ${summary.errors.length} errors`);
    } catch (err) {
      console.error("[scheduler] sync failed", err);
    }
  });
  console.log(`[scheduler] cron scheduled: ${schedule}`);
}
