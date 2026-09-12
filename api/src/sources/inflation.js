// CPI YoY (headline inflation) for the handful of countries where a free
// source gives it directly, without needing a new API key beyond FRED's
// (already required for US rates). Every other tracked country shows "—"
// for inflation/real-rate rather than a guessed or stale World Bank annual
// figure — see README for why.
//
// Each fetcher reports its own reference period (the month the CPI figure
// actually covers) so the UI can show real freshness instead of implying
// today's inflation is known today (CPI always has a multi-week-or-more
// publication lag everywhere in the world, unlike a policy rate decision).

async function fetchFredInflation() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY not set — skipping US inflation");

  // units=pc1 asks FRED to do the "percent change from a year ago" math
  // server-side, rather than us pulling raw index values and dividing.
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${apiKey}&file_type=json&units=pc1&sort_order=desc&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED CPI HTTP ${res.status}`);
  const data = await res.json();
  const obs = data.observations?.[0];
  if (!obs || obs.value === ".") throw new Error("FRED CPI: no observation returned");

  return {
    countryCode: "US",
    inflationRate: parseFloat(obs.value),
    inflationPeriod: obs.date.slice(0, 7), // "2026-08-01" -> "2026-08"
    inflationSource: "fred",
  };
}

async function fetchEuInflation() {
  // HICP, all-items, annual rate of change. The old table (prc_hicp_manr,
  // ECB's own ICP/U2 SDMX series) is DISCONTINUED — Eurostat replaced it with
  // prc_hicp_minr (and the euro-area code moved EA20 -> EA21 when Bulgaria
  // joined the euro on 2026-01-01). Verified live: this gives Aug 2026 data,
  // the old table was frozen at Dec 2025.
  const url = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr" +
    "?format=JSON&geo=EA21&unit=RCH_A&coicop18=TOTAL&lastTimePeriod=1";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Eurostat HICP HTTP ${res.status}`);
  const data = await res.json();

  const timeIndex = data.dimension?.time?.category?.index;
  const values = data.value;
  if (!timeIndex || !values) throw new Error("Eurostat HICP: unexpected response shape");

  const [period, idx] = Object.entries(timeIndex)[0] || [];
  const value = values[String(idx)];
  if (value === undefined || !period) throw new Error("Eurostat HICP: no observation returned");

  return { countryCode: "EA", inflationRate: value, inflationPeriod: period, inflationSource: "eurostat" };
}

async function fetchGbInflation() {
  // ONS decommissioned api.ons.gov.uk (Nov 2024) — the live endpoint is on
  // the main website domain. D7G7 = "CPI ANNUAL RATE 00: ALL ITEMS".
  const url = "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ONS CPI HTTP ${res.status}`);
  const data = await res.json();

  const desc = data.description;
  if (!desc?.number || !desc?.date) throw new Error("ONS CPI: unexpected response shape");

  // "2026 JUL" -> "2026-07"
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const [year, monStr] = desc.date.split(" ");
  const monthNum = months.indexOf(monStr) + 1;
  const period = monthNum ? `${year}-${String(monthNum).padStart(2, "0")}` : desc.date;

  return { countryCode: "GB", inflationRate: parseFloat(desc.number), inflationPeriod: period, inflationSource: "ons" };
}

async function fetchCaInflation() {
  // Bank of Canada Valet — same host/infra we already use for CA's policy
  // rate, just a different series: total CPI YoY, unadjusted.
  const url = "https://www.bankofcanada.ca/valet/observations/STATIC_TOTALCPICHANGE/json?recent=1";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BoC CPI HTTP ${res.status}`);
  const data = await res.json();
  const obs = data.observations?.[0];
  const value = obs?.STATIC_TOTALCPICHANGE?.v;
  if (!obs || value === undefined) throw new Error("BoC CPI: no observation returned");

  return {
    countryCode: "CA",
    inflationRate: parseFloat(value),
    inflationPeriod: obs.d.slice(0, 7), // "2026-07-01" -> "2026-07"
    inflationSource: "boc",
  };
}

async function fetchBcbInflation() {
  // Series 13522 = IPCA accumulated over 12 months — Brazil's headline YoY
  // inflation figure, already a rolling annual rate.
  const url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/dados/ultimos/1?formato=json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BCB IPCA HTTP ${res.status}`);
  const data = await res.json();
  const obs = data?.[0];
  if (!obs) throw new Error("BCB IPCA: no observation returned");

  const [, month, year] = obs.data.split("/");
  return {
    countryCode: "BR",
    inflationRate: parseFloat(obs.valor),
    inflationPeriod: `${year}-${month}`,
    inflationSource: "bcb",
  };
}

export async function fetchInflation() {
  const fetchers = [fetchFredInflation, fetchEuInflation, fetchGbInflation, fetchCaInflation, fetchBcbInflation];
  const results = [];
  const errors = [];

  for (const fetchFn of fetchers) {
    try {
      results.push(await fetchFn());
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (errors.length) {
    console.warn(`Inflation sync: ${errors.length} lookups failed:\n${errors.join("\n")}`);
  }

  return results;
}
