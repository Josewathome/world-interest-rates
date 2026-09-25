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
//    If it breaks, this must fail closed (throw, get skipped, log an
//    error) rather than ever serve a wrong or stale-looking-fresh number.
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

const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const CME_MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"]; // Jan..Dec
const STALE_SESSIONS = 3; // flag if the settle price hasn't moved across this many trading days

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
  return parseFloat(obs.value);
}

async function fetchContractHistory(symbol, days = 6) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${days}d&interval=1d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const data = await res.json();
  if (data.chart?.error) throw new Error(`Yahoo error for ${symbol}: ${JSON.stringify(data.chart.error)}`);
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  const timestamps = result?.timestamp;
  if (!closes || !timestamps) throw new Error(`Yahoo: unexpected response shape for ${symbol}`);

  return timestamps
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((o) => o.close !== null && o.close !== undefined);
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

export async function fetchRateExpectations() {
  const meetings = MEETING_CALENDARS.US || [];
  const today = new Date().toISOString().slice(0, 10);
  const nextMeeting = meetings.filter((m) => m >= today).sort()[0];
  if (!nextMeeting) throw new Error("No upcoming US FOMC meeting in the local calendar — refresh meetingCalendars.js");

  const effrNow = await fetchEffr();

  const [year, month] = nextMeeting.split("-").map(Number);
  const symbol = contractSymbol(year, month - 1);
  const history = await fetchContractHistory(symbol);
  if (!history.length) throw new Error(`No futures history returned for ${symbol}`);

  const latest = history[history.length - 1];
  const { impliedPostRate, impliedChangeBps } = impliedChangeFromContract(effrNow, nextMeeting, latest.close);
  const todayBuckets = bucketProbabilities(impliedChangeBps);

  // Staleness guard: has this contract's settle price actually moved across
  // the last few sessions, or is the feed just repeating a stale value?
  // Verified necessary in practice — a back-month ZQ contract sat completely
  // flat for 6 straight sessions during testing.
  const recentCloses = history.slice(-STALE_SESSIONS).map((o) => o.close);
  const stale = recentCloses.length === STALE_SESSIONS && recentCloses.every((c) => c === recentCloses[0]);

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
    source: "fred_effr+yahoo_cme_futures",
  }];
}
