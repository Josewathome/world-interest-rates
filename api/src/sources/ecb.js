// ECB Data Portal SDMX REST API — fully free, no key, no registration.
// https://data.ecb.europa.eu/help/api/overview
//
// Series: FM.D.U2.EUR.4F.KR.DFR.LEV = deposit facility rate, daily, level.
// The deposit facility rate is the ECB rate actually used as "the" policy
// rate reference since the 2022+ operational framework.
import { deriveHistory } from "../utils/history.js";

const SERIES_KEY = "D.U2.EUR.4F.KR.DFR.LEV";
// ~20 months of daily observations — spans several Governing Council
// decisions, giving enough transitions for a meaningful sparkline/streak.
const LOOKBACK_OBSERVATIONS = 600;

export async function fetchEcb() {
  const url = `https://data-api.ecb.europa.eu/service/data/FM/${SERIES_KEY}?lastNObservations=${LOOKBACK_OBSERVATIONS}&format=jsondata`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
  const data = await res.json();

  const series = data.dataSets?.[0]?.series;
  const seriesKey = series ? Object.keys(series)[0] : null;
  const obsMap = seriesKey ? series[seriesKey].observations : null;
  const timeValues = data.structure?.dimensions?.observation?.[0]?.values;
  if (!obsMap || !timeValues) throw new Error("ECB: unexpected response shape");

  // Sorted by observation index first (positional order within the SDMX
  // series), then by the actual date string as a final safety net — never
  // trust upstream ordering implicitly (a Bank of Canada source bug taught
  // us why).
  const observations = Object.keys(obsMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map((idx) => ({ date: timeValues[idx]?.id, value: obsMap[idx][0] }))
    .filter((o) => o.date && o.value !== null && o.value !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!observations.length) throw new Error("ECB: no observations returned");

  const history = deriveHistory(observations);

  return [{
    countryCode: "EA",
    currentRate: history.currentRate,
    rateEffectiveDate: history.currentEffectiveDate,
    seedPreviousRate: history.previousRate,
    transitions: history.transitions,
    rateType: "Deposit Facility Rate",
    source: "ecb",
    sourceCadence: "daily",
  }];
}
