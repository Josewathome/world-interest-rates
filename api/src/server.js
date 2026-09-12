import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getAllRates } from "./db/index.js";
import { runSync } from "./sync/index.js";
import publicRoutes from "./routes/public.js";
import v1Routes from "./routes/v1.js";
import internalRoutes from "./routes/internal.js";
import { startScheduler } from "./scheduler.js";
import { issueCookie } from "./middleware/dashboardToken.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/w", publicRoutes);
app.use("/api/v1", v1Routes);
app.use("/internal", internalRoutes);

// Sets the dashboard's short-lived signed cookie on the page-load response
// itself (see dashboardToken.js) — must run before express.static so the
// header rides along on the same response that serves index.html.
app.use(issueCookie);

// Static dashboard frontend
app.use(express.static(path.join(__dirname, "../../public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;

async function main() {
  await initDb();

  // Seed on boot if the DB is empty (e.g. first deploy, or a fresh SQLite
  // file on an ephemeral free-tier disk) so the dashboard is never blank.
  const existing = await getAllRates();
  if (existing.length === 0) {
    console.log("[boot] empty DB detected, running initial sync...");
    const summary = await runSync();
    console.log(`[boot] initial sync: ${summary.totalUpdated} updated, ${summary.errors.length} errors`);
  }

  if (process.env.DISABLE_INTERNAL_CRON !== "true") {
    startScheduler();
  }

  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
}

main().catch((err) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
