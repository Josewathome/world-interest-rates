// Bank of Canada Valet API — free, no key.
// https://www.bankofcanada.ca/valet/docs
// V39079 = target for the overnight rate (the BoC's policy rate).
import { deriveHistory } from "../utils/history.js";

const SERIES_ID = "V39079";
// ~20 months of business-daily observations — spans several BoC decisions,
// giving enough transitions for a meaningful sparkline/change-streak.
const LOOKBACK_RECENT = 600;

export async function fetchBoc() {
  const url = `https://www.bankofcanada.ca/valet/observations/${SERIES_ID}/json?recent=${LOOKBACK_RECENT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BoC HTTP ${res.status}`);
  const data = await res.json();

  // The Valet API returns observations newest-first — must sort ascending,
  // since deriveHistory assumes the last element is the most recent.
  const observations = (data.observations || [])
    .map((obs) => ({ date: obs.d, value: parseFloat(obs[SERIES_ID]?.v) }))
    .filter((o) => o.date && Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!observations.length) throw new Error("BoC: no observations returned");

  const history = deriveHistory(observations);

  return [{
    countryCode: "CA",
    currentRate: history.currentRate,
    rateEffectiveDate: history.currentEffectiveDate,
    seedPreviousRate: history.previousRate,
    transitions: history.transitions,
    rateType: "Target for the Overnight Rate",
    source: "boc",
    sourceCadence: "daily",
  }];
}
