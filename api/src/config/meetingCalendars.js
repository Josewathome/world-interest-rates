// Official published meeting/announcement dates for the central banks where a
// dedicated ("fast lane") source is wired up. These are published by each bank
// roughly a year in advance, so hand-maintaining this list once or twice a year
// is far more reliable than scraping each bank's calendar page.
//
// Date = the announcement date (UTC calendar date; banks announce local afternoon).
// Update this file whenever a bank publishes its next annual schedule.

// Only dates individually confirmed against each bank's official published
// schedule as of 2026-09-12 are listed here — earlier-in-the-year dates that
// have already passed were deliberately left out rather than guessed/padded,
// since nextMeetingDate() only ever looks forward from "now" and a wrong
// guess sitting unused is still a wrong guess. Re-verify and extend this list
// once these are exhausted (see the source for each).
export const MEETING_CALENDARS = {
  // https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (announcement = 2nd day)
  US: ["2026-09-16", "2026-10-28", "2026-12-09"],
  // https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html — Oct 28-29 is
  // explicitly confirmed as the FINAL Governing Council monetary policy meeting of 2026.
  EA: ["2026-10-29"],
  // https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates
  GB: ["2026-09-17", "2026-11-05", "2026-12-17"],
  // RBA board meeting schedule (announcement = 2nd day)
  AU: ["2026-09-29", "2026-11-03", "2026-12-08"],
  // https://www.bankofcanada.ca/2025/08/bank-canada-publishes-2026-schedule-... (2025-08 release)
  CA: ["2026-09-02", "2026-10-28", "2026-12-09"],
};

// Returns the next meeting date (ISO string) after `fromDate` for a country
// code, or null if the source data is missing or all known dates have passed
// (meaning our hand-maintained list needs a refresh for the next cycle).
export function nextMeetingDate(countryCode, fromDate = new Date()) {
  const dates = MEETING_CALENDARS[countryCode];
  if (!dates) return null;
  const fromMs = fromDate.getTime();
  const upcoming = dates
    .map((d) => new Date(`${d}T00:00:00Z`))
    .filter((d) => d.getTime() >= fromMs)
    .sort((a, b) => a - b);
  return upcoming.length ? upcoming[0].toISOString().slice(0, 10) : null;
}
