import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStreak } from "../utils/history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Local dev: plain SQLite file, no account needed.
// Production: point TURSO_DATABASE_URL / TURSO_AUTH_TOKEN at a free Turso DB
// so data survives container restarts/redeploys on ephemeral free hosting.
const url = process.env.TURSO_DATABASE_URL || "file:./data/local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

if (url.startsWith("file:")) {
  const dir = path.dirname(url.slice("file:".length));
  fs.mkdirSync(dir, { recursive: true });
}

export const db = createClient(authToken ? { url, authToken } : { url });

export async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await db.executeMultiple(schema);
}

export async function upsertRate(row) {
  const existing = await db.execute({
    sql: "SELECT current_rate, previous_rate, transitions FROM rates WHERE country_code = ?",
    args: [row.countryCode],
  });

  const isNewRow = existing.rows.length === 0;
  const priorCurrent = existing.rows[0]?.current_rate ?? null;
  const priorPrevious = existing.rows[0]?.previous_rate ?? null;
  const rateChanged = priorCurrent !== null && row.currentRate !== null && priorCurrent !== row.currentRate;

  // Ongoing deltas are always computed locally from our own tracked
  // history, never trusted from an upstream API's "previous" field. The
  // one exception is the very first time we see a country: sources look
  // back through their own history to find the last real change, so we can
  // seed a meaningful previous_rate/change immediately instead of showing
  // blank cells until we happen to observe a live transition ourselves.
  const previousRate = rateChanged
    ? priorCurrent
    : isNewRow
      ? (row.seedPreviousRate ?? null)
      : priorPrevious;
  const changeBps = previousRate !== null && row.currentRate !== null
    ? Math.round((row.currentRate - previousRate) * 100 * 100) / 100
    : null;

  // Transitions are purely informational (sparkline/streak), so unlike
  // current/previous_rate above, we always take the freshest value a source
  // provides — falling back to whatever was already stored if this sync
  // didn't supply any (e.g. a future source that doesn't implement history).
  const transitionsJson = row.transitions !== undefined
    ? JSON.stringify(row.transitions)
    : (existing.rows[0]?.transitions ?? "[]");

  await db.execute({
    sql: `INSERT INTO rates (
            country_code, country_name, central_bank_name, region, tags, rate_type,
            current_rate, previous_rate, change_bps, rate_effective_date, transitions,
            next_meeting_date, source, source_cadence, currency_code, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(country_code) DO UPDATE SET
            country_name = excluded.country_name,
            central_bank_name = excluded.central_bank_name,
            region = excluded.region,
            tags = excluded.tags,
            rate_type = excluded.rate_type,
            current_rate = excluded.current_rate,
            previous_rate = excluded.previous_rate,
            change_bps = excluded.change_bps,
            rate_effective_date = excluded.rate_effective_date,
            transitions = excluded.transitions,
            next_meeting_date = excluded.next_meeting_date,
            source = excluded.source,
            source_cadence = excluded.source_cadence,
            currency_code = excluded.currency_code,
            updated_at = excluded.updated_at`,
    args: [
      row.countryCode,
      row.countryName,
      row.centralBankName,
      row.region,
      JSON.stringify(row.tags || []),
      row.rateType || null,
      row.currentRate,
      previousRate,
      changeBps,
      row.rateEffectiveDate || null,
      transitionsJson,
      row.nextMeetingDate || null,
      row.source,
      row.sourceCadence || null,
      row.currency || null,
      new Date().toISOString(),
    ],
  });

  if (rateChanged) {
    await db.execute({
      sql: `INSERT INTO rate_history (country_code, old_rate, new_rate, change_bps, changed_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [row.countryCode, priorCurrent, row.currentRate, changeBps, new Date().toISOString()],
    });
  }

  return { changed: rateChanged };
}

// Inflation/FX are independent, lower-frequency enrichments layered onto an
// existing rate row — only takes effect if the country's row already exists
// (it always will, since rate sources run before these in sync/index.js).
export async function upsertInflation(countryCode, { inflationRate, inflationPeriod, inflationSource }) {
  await db.execute({
    sql: `UPDATE rates SET inflation_rate = ?, inflation_period = ?, inflation_source = ?
          WHERE country_code = ?`,
    args: [inflationRate, inflationPeriod, inflationSource, countryCode],
  });
}

export async function upsertFx(countryCode, { fxRate, fxRateDate }) {
  await db.execute({
    sql: `UPDATE rates SET fx_rate = ?, fx_rate_date = ? WHERE country_code = ?`,
    args: [fxRate, fxRateDate, countryCode],
  });
}

const RATE_COLUMNS = [
  "country_code", "country_name", "central_bank_name", "region", "tags",
  "rate_type", "current_rate", "previous_rate", "change_bps",
  "rate_effective_date", "transitions", "next_meeting_date", "source", "source_cadence",
  "currency_code", "inflation_rate", "inflation_period", "inflation_source",
  "fx_rate", "fx_rate_date", "updated_at",
];

export async function getAllRates() {
  const res = await db.execute("SELECT * FROM rates ORDER BY country_name ASC");
  return res.rows.map(deserializeRate);
}

export async function getRateByCode(code) {
  const res = await db.execute({
    sql: "SELECT * FROM rates WHERE country_code = ?",
    args: [code.toUpperCase()],
  });
  return res.rows[0] ? deserializeRate(res.rows[0]) : null;
}

// @libsql/client Row objects carry both numeric-index and named properties,
// so a naive {...row} spread would leak duplicate numeric keys into the API
// response — pick named columns explicitly instead.
function deserializeRate(row) {
  const out = {};
  for (const col of RATE_COLUMNS) out[col] = row[col];
  out.tags = JSON.parse(row.tags || "[]");
  out.transitions = JSON.parse(row.transitions || "[]");
  out.streak = computeStreak(out.transitions);
  // Real (inflation-adjusted) rate — simple Fisher approximation
  // (nominal - inflation), only meaningful where we actually have inflation
  // data; never fabricated for the many countries we don't cover.
  out.real_rate = out.current_rate !== null && out.inflation_rate !== null && out.inflation_rate !== undefined
    ? Math.round((out.current_rate - out.inflation_rate) * 100) / 100
    : null;
  return out;
}

export async function logSync(source, status, message, countriesUpdated = 0) {
  await db.execute({
    sql: `INSERT INTO sync_log (source, status, message, countries_updated, ran_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [source, status, message || null, countriesUpdated, new Date().toISOString()],
  });
}

// sync_log grows by ~8 rows every sync cycle forever (≈140k rows/year at the
// default 30-minute cron) — trivial in bytes, but unbounded rows aren't a
// good look for a "long-running" table. Keep the last N days only; called
// once per sync run in sync/index.js.
export async function pruneSyncLog(retentionDays = 14) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  await db.execute({ sql: "DELETE FROM sync_log WHERE ran_at < ?", args: [cutoff] });
}

const SYNC_LOG_COLUMNS = ["id", "source", "status", "message", "countries_updated", "ran_at"];

export async function getRecentSyncLog(limit = 50) {
  const res = await db.execute({
    sql: "SELECT * FROM sync_log ORDER BY id DESC LIMIT ?",
    args: [limit],
  });
  return res.rows.map((row) => {
    const out = {};
    for (const col of SYNC_LOG_COLUMNS) out[col] = row[col];
    return out;
  });
}
