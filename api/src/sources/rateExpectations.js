// Market-implied Fed Funds rate expectations for the next FOMC meeting —
// the same thing CME's FedWatch tool shows, computed ourselves instead of
// paying CME ~$25/mo for API access.
//
// Data used (both free, no key beyond the FRED key this project already
// requires):
//  - EFFR (Effective Federal Funds Rate), daily, from FRED — the actual
//    overnight rate the futures price quotes against. NOT the same as
//    DFEDTARU (src/sources/fred.js), which is only the target range's
//    upper bound.
//  - Individual-month CME 30-Day Fed Funds futures (ZQ) contract prices,
//    from Yahoo Finance's unofficial chart API — the SAME undocumented
//    endpoint the popular `yfinance` Python library scrapes. This is the
//    one data source in this whole project that isn't an official
//    government/central-bank API: no published contract, no stability
//    guarantee, could change shape or start blocking us without notice.
//
// Because that source is unofficial, every fetch is independently verified
// below — not a one-time manual check, but something every sync run does
// for itself, every time:
//   1. Yahoo's response echoes the symbol back (meta.symbol) — confirms we
//      got the contract we actually asked for, not something substituted.
//   2. Yahoo's longName truncates to the contract month's first two letters
//      (e.g. "...Oc" for October) — cross-checked against the month we
//      requested, so a symbol-format change on their end trips an error
//      instead of silently mispricing a different month.
//   3. EFFR and the futures price are range-checked (0-20% and 50-100
//      respectively) — catches a wrong series, a unit error, or garbage.
//   4. EFFR is cross-checked against the target rate we already track from
//      FRED's own DFEDTARU series (src/sources/fred.js) — they should sit
//      within ~60bp of each other; a bigger gap means one of the two feeds
//      is wrong, not that the Fed did something extraordinary.
//   5. The implied move itself is capped at a generous ±150bp — real FOMC
//      moves are essentially always 0/25/50bp; anything past that is bad
//      data, not a real market view.
//   6. Staleness: has the settle price actually moved recently, or is the
//      feed just repeating a stale value? Verified necessary in practice —
//      a back-month contract sat flat for 6 straight sessions during
//      testing. Rather than just a yes/no, we look back up to 35 days to
//      find the real last-change date (reusing the same step-history logic
//      the sparklines use) and report how many days that actually is — not
//      just "possibly stale" with no way to judge how stale. Low/zero
//      trading volume is treated as the same signal.
// Any failed check throws, which (via sync/index.js's error handling) skips
// the update for that cycle and leaves the last known-good value in place —
// this must fail closed, never serve a wrong number with false confidence.
//
// Method: a 30-Day Fed Funds future settles at 100 minus the average daily
// EFFR over its contract calendar month. For a month containing exactly one
// FOMC meeting on day D of N days, that average blends the pre-meeting rate
// (D days) and the market's implied post-meeting rate (N-D days):
//   avg = (D/N) * effr_now + ((N-D)/N) * implied_post_meeting_rate
// Solve for implied_post_meeting_rate, diff it against effr_now for an
// implied move in bps, then split that between the two nearest 25bp
// outcomes (hold / 25bp cut / 25bp hike) by linear interpolation — the same
// simplification most independent FedWatch replicas use, accurate as long
// as the contract month contains a single meeting (true for every US FOMC
// meeting: they're never two-to-a-month).
import { MEETING_CALENDARS } from "../config/meetingCalendars.js";
import { extractTransitions } from "../utils/history.js";

const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const CME_MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"]; // Jan..Dec
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const PRICE_LOOKBACK_DAYS = 35; // wide enough to find a real last-change date, not just "not in the last week"
const STALE_DAYS_THRESHOLD = 4; // flag as stale once the price has sat unchanged this many calendar days
const EFFR_VS_TARGET_TOLERANCE = 0.60; // percentage points
const MAX_PLAUSIBLE_MOVE_BPS = 150;

function contractSymbol(year, monthIndex0) {
  const code = CME_MONTH_CODES[monthIndex0];
  const yy = String(year).slice(-2);
  return `ZQ${code}${yy}.CBT`;
}

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

async function fetchEffr() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY not set — skipping rate expectations");
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=EFFR&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED EFFR HTTP ${res.status}`);
  const data = await res.json();
  const obs = data.observations?.[0];
  if (!obs || obs.value === ".") throw new Error("FRED EFFR: no observation returned");
  const value = parseFloat(obs.value);
  if (!Number.isFinite(value) || value < 0 || value > 20) {
    throw new Error(`FRED EFFR: implausible value ${value} — refusing to use it`);
  }
  return value;
}

async function fetchContractQuote(symbol, monthIndex0, days = PRICE_LOOKBACK_DAYS) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${days}d&interval=1d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const data = await res.json();
  if (data.chart?.error) throw new Error(`Yahoo error for ${symbol}: ${JSON.stringify(data.chart.error)}`);
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const closes = result?.indicators?.quote?.[0]?.close;
  const timestamps = result?.timestamp;
  if (!meta || !closes || !timestamps) throw new Error(`Yahoo: unexpected response shape for ${symbol}`);

  // Check 1: did we actually get the contract we asked for, not something
  // Yahoo silently substituted or redirected to?
  if (meta.symbol !== symbol) {
    throw new Error(`Yahoo: requested ${symbol}, response echoed symbol ${meta.symbol} — refusing to trust it`);
  }

  // Check 2: Yahoo's longName truncates to the contract month's first two
  // letters (observed: "...Oc" for October). Cross-check against the month
  // we actually requested, so a future format change trips an error instead
  // of silently mispricing a different month than we think we have.
  const expectedPrefix = MONTH_NAMES[monthIndex0].slice(0, 2);
  const nameField = meta.longName || meta.shortName || "";
  if (!nameField.includes(expectedPrefix)) {
    throw new Error(`Yahoo: expected "${expectedPrefix}" in contract name for ${symbol}, got "${nameField}" — month mismatch`);
  }

  const history = timestamps
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((o) => o.close !== null && o.close !== undefined);
  if (!history.length) throw new Error(`Yahoo: no usable price history for ${symbol}`);

  const latestClose = history[history.length - 1].close;
  if (!Number.isFinite(latestClose) || latestClose < 50 || latestClose > 100) {
    throw new Error(`Yahoo: implausible futures price ${latestClose} for ${symbol} — refusing to use it`);
  }

  return { history, volume: meta.regularMarketVolume ?? 0 };
}

// Splits an implied move into hold/cut/hike percentages by linear
// interpolation between the two nearest 25bp standard outcomes. A move
// beyond ±25bp (the market pricing a 50bp+ step) gets clamped for this
// simple 3-bucket display — impliedChangeBps itself is still returned
// unclamped so nothing is silently hidden.
function bucketProbabilities(impliedChangeBps) {
  const clamped = Math.max(-25, Math.min(25, impliedChangeBps));
  if (clamped <= 0) {
    const cut = Math.abs(clamped) / 25;
    return { holdPct: (1 - cut) * 100, cutPct: cut * 100, hikePct: 0 };
  }
  const hike = clamped / 25;
  return { holdPct: (1 - hike) * 100, cutPct: 0, hikePct: hike * 100 };
}

function impliedChangeFromContract(effrNow, meetingDate, latestClose) {
  const [year, month, day] = meetingDate.split("-").map(Number);
  const monthIndex0 = month - 1;
  const n = daysInMonth(year, monthIndex0);
  const d = day;

  const avgRate = 100 - latestClose;
  const impliedPostRate = (avgRate - (d / n) * effrNow) / ((n - d) / n);
  const impliedChangeBps = Math.round((impliedPostRate - effrNow) * 100 * 100) / 100;
  return { impliedPostRate, impliedChangeBps };
}

// `knownTargetRate` is the US target rate we already have from FRED's
// DFEDTARU series (src/sources/fred.js / the rates table) — passed in by
// sync/index.js so this module doesn't need its own DB access. Used purely
// as a cross-check that EFFR is in the right ballpark.
export async function fetchRateExpectations(knownTargetRate) {
  const meetings = MEETING_CALENDARS.US || [];
  const today = new Date().toISOString().slice(0, 10);
  const nextMeeting = meetings.filter((m) => m >= today).sort()[0];
  if (!nextMeeting) throw new Error("No upcoming US FOMC meeting in the local calendar — refresh meetingCalendars.js");

  const effrNow = await fetchEffr();

  if (typeof knownTargetRate === "number" && Math.abs(effrNow - knownTargetRate) > EFFR_VS_TARGET_TOLERANCE) {
    throw new Error(
      `EFFR (${effrNow}) is more than ${EFFR_VS_TARGET_TOLERANCE}pp from the known target rate (${knownTargetRate}) — ` +
      `one of these feeds is likely wrong, refusing to compute expectations on top of it`
    );
  }

  const [year, month] = nextMeeting.split("-").map(Number);
  const monthIndex0 = month - 1;
  const symbol = contractSymbol(year, monthIndex0);
  const { history, volume } = await fetchContractQuote(symbol, monthIndex0);

  const latest = history[history.length - 1];
  const { impliedPostRate, impliedChangeBps } = impliedChangeFromContract(effrNow, nextMeeting, latest.close);

  if (Math.abs(impliedChangeBps) > MAX_PLAUSIBLE_MOVE_BPS) {
    throw new Error(
      `Implied move of ${impliedChangeBps}bp exceeds the ${MAX_PLAUSIBLE_MOVE_BPS}bp plausibility cap — ` +
      `treating as bad data rather than a real market view`
    );
  }

  const todayBuckets = bucketProbabilities(impliedChangeBps);

  // Staleness, with an actual answer to "since when" — not just yes/no.
  // Reuses the same step-history logic the sparklines use: walk the price
  // series back (up to PRICE_LOOKBACK_DAYS) to find the last date it
  // actually changed, rather than just checking the last few days.
  const priceTransitions = extractTransitions(history.map((o) => ({ date: o.date, value: o.close })));
  const lastPriceChange = priceTransitions[priceTransitions.length - 1];
  // If there's only one "transition" (the anchor point), the price never
  // moved anywhere in our whole lookback window — we only know it was
  // already at this value on the earliest date we looked at, not when it
  // truly started, so this is a lower bound, not an exact answer.
  const unchangedIsLowerBound = priceTransitions.length < 2;
  const unchangedSince = lastPriceChange.date;
  const unchangedDays = Math.round(
    (new Date(`${today}T00:00:00Z`) - new Date(`${unchangedSince}T00:00:00Z`)) / 86_400_000
  );

  // Zero/near-zero trading volume is treated as the same signal — a price
  // that "hasn't moved" because nobody's trading it is just as untrustworthy
  // as one that's genuinely stuck. Tracked as a distinct reason, since "stale
  // because of 8 unchanged days" and "stale because of no volume today" call
  // for different levels of concern.
  const daysStale = unchangedDays >= STALE_DAYS_THRESHOLD;
  const volumeStale = volume < 10;
  const stale = daysStale || volumeStale;
  const staleReason = daysStale ? "unchanged_days" : volumeStale ? "low_volume" : null;

  // "Change vs yesterday" — recompute using the prior session's close so we
  // can show how expectations moved, not just where they sit today.
  let cutPctChangeVsYesterday = null;
  if (history.length >= 2) {
    const yesterdayClose = history[history.length - 2].close;
    const y = impliedChangeFromContract(effrNow, nextMeeting, yesterdayClose);
    const yesterdayBuckets = bucketProbabilities(y.impliedChangeBps);
    cutPctChangeVsYesterday = Math.round((todayBuckets.cutPct - yesterdayBuckets.cutPct) * 10) / 10;
  }

  return [{
    countryCode: "US",
    meetingDate: nextMeeting,
    impliedChangeBps,
    impliedPostMeetingRate: Math.round(impliedPostRate * 100) / 100,
    holdPct: Math.round(todayBuckets.holdPct * 10) / 10,
    cutPct: Math.round(todayBuckets.cutPct * 10) / 10,
    hikePct: Math.round(todayBuckets.hikePct * 10) / 10,
    cutPctChangeVsYesterday,
    stale,
    staleReason,
    unchangedSince,
    unchangedDays,
    unchangedIsLowerBound,
    source: "fred_effr+yahoo_cme_futures",
  }];
}
