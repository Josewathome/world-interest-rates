import { fetchFred } from "../sources/fred.js";
import { fetchEcb } from "../sources/ecb.js";
import { fetchBoe } from "../sources/boe.js";
import { fetchBoc } from "../sources/boc.js";
import { fetchBcb } from "../sources/bcb.js";
import { fetchBis } from "../sources/bis.js";
import { fetchInflation } from "../sources/inflation.js";
import { fetchFx } from "../sources/fx.js";
import { COUNTRIES_BY_CODE } from "../config/countries.js";
import { nextMeetingDate } from "../config/meetingCalendars.js";
import { upsertRate, upsertInflation, upsertFx, logSync, pruneSyncLog } from "../db/index.js";

// Order matters only in that "bis" runs last as the universal baseline —
// each dedicated fast-lane source only ever writes its own country, so there
// is no overwrite race between them.
const SOURCES = [
  { name: "fred", fetch: fetchFred },
  { name: "ecb", fetch: fetchEcb },
  { name: "boe", fetch: fetchBoe },
  { name: "boc", fetch: fetchBoc },
  { name: "bcb", fetch: fetchBcb },
  { name: "bis", fetch: fetchBis },
];

export async function runSync() {
  const summary = { totalUpdated: 0, changedCountries: [], errors: [] };

  for (const { name, fetch: fetchFn } of SOURCES) {
    try {
      const rows = await fetchFn();
      let countUpdated = 0;
      const rowErrors = [];

      for (const row of rows) {
        const meta = COUNTRIES_BY_CODE[row.countryCode];
        if (!meta) continue;

        // A single malformed row (bad upstream data, a parsing edge case)
        // must never take down the rest of this source's countries.
        try {
          const result = await upsertRate({
            ...row,
            countryName: meta.name,
            centralBankName: meta.centralBank,
            region: meta.region,
            tags: meta.tags,
            currency: meta.currency,
            nextMeetingDate: nextMeetingDate(row.countryCode),
          });
          countUpdated++;
          if (result.changed) summary.changedCountries.push(row.countryCode);
        } catch (rowErr) {
          rowErrors.push(`${row.countryCode}: ${rowErr.message}`);
        }
      }

      summary.totalUpdated += countUpdated;
      const message = rowErrors.length
        ? `${countUpdated} countries updated; ${rowErrors.length} row errors: ${rowErrors.join("; ")}`
        : `${countUpdated} countries updated`;
      await logSync(name, rowErrors.length ? "partial" : "ok", message, countUpdated);
      if (rowErrors.length) summary.errors.push(`${name}: ${rowErrors.join("; ")}`);
    } catch (err) {
      summary.errors.push(`${name}: ${err.message}`);
      await logSync(name, "error", err.message, 0);
    }
  }

  // Enrichment passes — layered onto existing rate rows, never affecting
  // current/previous_rate/change tracking above.
  await runEnrichment(summary, "inflation", fetchInflation, (row) => upsertInflation(row.countryCode, row));
  await runEnrichment(summary, "fx", fetchFx, (row) => upsertFx(row.countryCode, row));

  // Keep sync_log from growing forever — see pruneSyncLog's comment.
  await pruneSyncLog();

  return summary;
}

async function runEnrichment(summary, name, fetchFn, upsertFn) {
  try {
    const rows = await fetchFn();
    for (const row of rows) await upsertFn(row);
    await logSync(name, "ok", `${rows.length} countries updated`, rows.length);
  } catch (err) {
    summary.errors.push(`${name}: ${err.message}`);
    await logSync(name, "error", err.message, 0);
  }
}
