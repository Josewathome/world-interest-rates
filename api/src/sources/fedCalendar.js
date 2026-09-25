// Auto-refreshes the US FOMC meeting calendar from the Fed's own calendar
// page, instead of relying on someone noticing config/meetingCalendars.js's
// hand-maintained list has run dry (previously: a calendar reminder to
// manually re-check federalreserve.gov once or twice a year).
//
// Why scraping is reasonable here — unlike most places in this project,
// where scraping was deliberately avoided in favor of official APIs: the
// Fed's calendar page has used the exact same `fomc-meeting` /
// `fomc-meeting__month` / `fomc-meeting__date` markup for every year from
// 2021 through the already-published 2027 schedule — 6+ years of
// structural stability, verified directly against the live page. Still
// fails closed: if the expected markup isn't found, or a year's meeting
// count looks implausible (FOMC always meets 8x/year — 6-10 is a generous
// tolerance), that year's dates are simply not used rather than trusted.
const FED_CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const MIN_MEETINGS_PER_YEAR = 6;
const MAX_MEETINGS_PER_YEAR = 10;

const MONTH_INDEX = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// "26-27" / "8-9*" / "30" -> the announcement date (FOMC announces on the
// second of two meeting days; a bare single day is used as-is).
function parseAnnouncementDay(rangeText, year, monthIndex0) {
  const cleaned = rangeText.replace(/[^\d-]/g, "");
  const parts = cleaned.split("-").filter(Boolean).map(Number);
  const day = parts[parts.length - 1];
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, monthIndex0)) return null;
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Returns { "2026": ["2026-01-28", ...], "2027": [...] } for every year
// panel found on the page whose parsed meeting count passes the sanity
// check. Throws if the page structure doesn't match at all.
export async function fetchFedCalendarDates() {
  const res = await fetch(FED_CALENDAR_URL);
  if (!res.ok) throw new Error(`Fed calendar HTTP ${res.status}`);
  const html = await res.text();

  const yearPanelRe = /id="\d+">(\d{4}) FOMC Meetings<\/a><\/h4><\/div>/g;
  const panels = [...html.matchAll(yearPanelRe)];
  if (!panels.length) throw new Error("Fed calendar: no year panels found — page structure may have changed");

  const results = {};
  for (let i = 0; i < panels.length; i++) {
    const year = Number(panels[i][1]);
    const start = panels[i].index;
    const end = i + 1 < panels.length ? panels[i + 1].index : html.length;
    const section = html.slice(start, end);

    const entryRe = /fomc-meeting__month[^"]*"[^>]*><strong>(\w+)<\/strong>[\s\S]*?fomc-meeting__date[^"]*"[^>]*>([^<]+)</g;
    const dates = [];
    for (const m of section.matchAll(entryRe)) {
      const monthIndex0 = MONTH_INDEX[m[1]];
      if (monthIndex0 === undefined) continue;
      const iso = parseAnnouncementDay(m[2], year, monthIndex0);
      if (iso) dates.push(iso);
    }

    if (dates.length >= MIN_MEETINGS_PER_YEAR && dates.length <= MAX_MEETINGS_PER_YEAR) {
      results[year] = dates.sort();
    }
    // Else: implausible count for this year — likely a parsing mismatch,
    // not a real 3-meeting or 15-meeting year. Skip silently; other years
    // on the same page are unaffected.
  }

  if (!Object.keys(results).length) {
    throw new Error("Fed calendar: parsed zero plausible years — refusing to trust any of it");
  }
  return results;
}
