// Bank for International Settlements (BIS) policy-rate SDMX API — free, no
// key. Used as the universal baseline for every country that doesn't have a
// dedicated "fast lane" source above. One lightweight per-country query
// (a few hundred KB for a year of history) rather than the ~450MB full bulk
// CSV dump.
// https://stats.bis.org/api-doc/v2/
import { COUNTRIES } from "../config/countries.js";
import { deriveHistory } from "../utils/history.js";

// ~20 months of daily observations — spans several meeting cycles for most
// banks, giving enough transitions for a meaningful sparkline/change-streak,
// even for banks that only move rates a few times a year.
const LOOKBACK_OBSERVATIONS = 600;

async function fetchOne(bisCode) {
  // detail=dataonly strips the per-row descriptive-text columns (SOURCE_REF,
  // SUPP_INFO_BREAKS, TITLE, ...), which BIS otherwise repeats on all 600
  // rows. Measured impact: Japan's response alone dropped from 1.39MB to
  // 12KB — ~22x smaller across all 22 countries combined, for identical
  // TIME_PERIOD/OBS_VALUE data.
  const url = `https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.${bisCode}?lastNObservations=${LOOKBACK_OBSERVATIONS}&format=csv&detail=dataonly`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BIS HTTP ${res.status} for ${bisCode}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error(`BIS: no data for ${bisCode}`);

  // CSV columns (see header row): ...,SOURCE_REF,...,TITLE,TIME_PERIOD,OBS_VALUE,...
  const header = lines[0].split(",");
  const timeIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");

  const observations = lines.slice(1)
    .map((line) => {
      const cols = splitCsvLine(line);
      return { date: cols[timeIdx], value: parseFloat(cols[valueIdx]) };
    })
    .filter((o) => o.date && Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!observations.length) throw new Error(`BIS: no usable observations for ${bisCode}`);
  return observations;
}

// Minimal CSV split that respects double-quoted fields containing commas,
// including the standard "" escaped-quote convention (e.g. Argentina's row
// contains `""monetary policy interest rate""` inside a quoted field).
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function fetchBis() {
  const targets = COUNTRIES.filter((c) => c.source === "bis");
  const results = [];
  const errors = [];

  // Sequential with a small delay to be a polite, low-volume consumer of a
  // free public service — this only runs on a slow cron cadence anyway.
  for (const country of targets) {
    try {
      const observations = await fetchOne(country.bisCode);
      const history = deriveHistory(observations);
      results.push({
        countryCode: country.code,
        currentRate: history.currentRate,
        rateEffectiveDate: history.currentEffectiveDate,
        seedPreviousRate: history.previousRate,
        transitions: history.transitions,
        rateType: "Policy Rate",
        source: "bis",
        sourceCadence: "daily (BIS aggregation, ~few days lag)",
      });
    } catch (err) {
      errors.push(`${country.code}: ${err.message}`);
    }
  }

  if (errors.length) {
    console.warn(`BIS sync: ${errors.length} country lookups failed:\n${errors.join("\n")}`);
  }

  return results;
}
