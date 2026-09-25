import { fetchFred } from "../sources/fred.js";
import { fetchEcb } from "../sources/ecb.js";
import { fetchBoe } from "../sources/boe.js";
import { fetchBoc } from "../sources/boc.js";
import { fetchBcb } from "../sources/bcb.js";
import { fetchBis } from "../sources/bis.js";
import { fetchInflation } from "../sources/inflation.js";
import { fetchFx } from "../sources/fx.js";
import { fetchRateExpectations } from "../sources/rateExpectations.js";
import { fetchFedCalendarDates } from "../sources/fedCalendar.js";
import { COUNTRIES_BY_CODE } from "../config/countries.js";
import { MEETING_CALENDARS, nextMeetingDate } from "../config/meetingCalendars.js";
import {
  upsertRate, upsertInflation, upsertFx, upsertRateExpectations,
  getRateByCode, getDiscoveredMeetingDates, insertDiscoveredMeetingDates,
  logSync, pruneSyncLog,
} from "../db/index.js";

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

// Don't hit the Fed's site every sync — only refresh once the known runway
// (hand-maintained baseline + anything already auto-discovered) gets short.
const CALENDAR_BUFFER_DAYS = 60;

export async function runSync() {
  const summary = { totalUpdated: 0, changedCountries: [], errors: [] };

  await refreshFedCalendarIfNeeded(summary);

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
            nextMeetingDate: await nextMeetingDate(row.countryCode),
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
  // Cross-checked against the target rate we already have from FRED's own
  // DFEDTARU series — see rateExpectations.js's file-header comment for why.
  const usRow = await getRateByCode("US");
  await runEnrichment(
    summary,
    "rate_expectations",
    () => fetchRateExpectations(usRow?.current_rate),
    (row) => upsertRateExpectations(row.countryCode, row)
  );

  // Keep sync_log from growing forever — see pruneSyncLog's comment.
  await pruneSyncLog();

  return summary;
}

// Auto-refreshes the US FOMC calendar from the Fed's own page once the known
// runway (hand-maintained list + anything already discovered) runs under
// CALENDAR_BUFFER_DAYS — see src/sources/fedCalendar.js for why scraping is
// reasonable here and what "fails closed" means for it. Only ever adds
// dates; never touches config/meetingCalendars.js or removes anything.
async function refreshFedCalendarIfNeeded(summary) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const staticDates = MEETING_CALENDARS.US || [];
  const discovered = await getDiscoveredMeetingDates("US");
  const knownFuture = [...staticDates, ...discovered].filter((d) => d >= todayIso).sort();
  const furthest = knownFuture[knownFuture.length - 1];
  const bufferDays = furthest
    ? Math.round((new Date(`${furthest}T00:00:00Z`) - new Date(`${todayIso}T00:00:00Z`)) / 86_400_000)
    : -1;

  if (furthest && bufferDays >= CALENDAR_BUFFER_DAYS) {
    // Plenty of runway — don't hit the Fed's site needlessly. Still logged
    // (as "skipped", not silence) so sync_log can confirm this check is
    // alive and show the current buffer, not just go quiet when there's
    // nothing to do.
    await logSync("fed_calendar", "skipped", `buffer is ${bufferDays}d (furthest known: ${furthest}), refresh not needed yet`, 0);
    return;
  }

  try {
    const byYear = await fetchFedCalendarDates();
    const allScraped = Object.values(byYear).flat();
    const newDates = allScraped.filter((d) => d >= todayIso && !knownFuture.includes(d));
    if (newDates.length) {
      await insertDiscoveredMeetingDates("US", newDates, "fed_calendar_scrape");
    }
    await logSync("fed_calendar", "ok", `buffer was ${bufferDays}d, added ${newDates.length} new date(s)`, newDates.length);
  } catch (err) {
    summary.errors.push(`fed_calendar: ${err.message}`);
    await logSync("fed_calendar", "error", err.message, 0);
  }
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
