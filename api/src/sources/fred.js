// Federal Reserve Bank of St. Louis (FRED) — free API key, no card required.
// https://fred.stlouisfed.org/docs/api/fred/
//
// FEDFUNDS is only a monthly average, so we use the daily FOMC target-range
// series instead: DFEDTARU (upper bound) is what's commonly quoted as "the"
// Fed rate.
import { deriveHistory } from "../utils/history.js";

const SERIES_ID = "DFEDTARU";
// ~20 months of daily observations — spans several FOMC decisions, giving
// enough transitions for a meaningful sparkline/change-streak, not just a
// single seeded previous_rate.
const LOOKBACK_LIMIT = 600;

export async function fetchFred() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error("FRED_API_KEY not set — skipping FRED sync");
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${SERIES_ID}&api_key=${apiKey}&file_type=json&sort_order=asc&limit=${LOOKBACK_LIMIT}&observation_start=${lookbackStartDate()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  const data = await res.json();
  // sort_order=asc is requested above, but never trust upstream ordering
  // implicitly — sort explicitly (a Bank of Canada source bug taught us why).
  const observations = (data.observations || [])
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!observations.length) throw new Error("FRED: no observations returned");

  const history = deriveHistory(observations);

  return [{
    countryCode: "US",
    currentRate: history.currentRate,
    rateEffectiveDate: history.currentEffectiveDate,
    seedPreviousRate: history.previousRate,
    transitions: history.transitions,
    rateType: "Fed Funds Target Range (Upper Bound)",
    source: "fred",
    sourceCadence: "daily",
  }];
}

function lookbackStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_LIMIT);
  return d.toISOString().slice(0, 10);
}
