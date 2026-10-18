// Central Bank of Brazil (BCB) SGS API — free, no key.
// Series 432 = "Meta Selic definida pelo Copom" (the official Selic target rate).
import { deriveHistory } from "../utils/history.js";
import { fetchJson } from "../utils/http.js";

// BCB's SGS API reports its own failures with HTTP 200 — an error object
// like {"erro": {"statusCode": 500, "detail": "Internal error"}} instead of
// the array of observations — so a successful status says nothing about
// whether the body is usable. Shared with the IPCA fetcher in inflation.js.
export function validateBcbSeries(data) {
  if (!Array.isArray(data)) return `API returned an error object instead of data: ${JSON.stringify(data).slice(0, 80)}`;
  if (!data.length) return "API returned an empty series";
  return null;
}

const SERIES_ID = 432;
// The /dados/ultimos/N endpoint caps N at 20 ("quantidade máxima de valores
// deve ser 20"), which isn't enough history to find the last real change —
// use the date-range endpoint instead, which has no such cap.
// ~20 months, spanning several Copom decisions for a meaningful sparkline/streak.
const LOOKBACK_DAYS = 600;

function formatBrDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function fetchBcb() {
  const dataFinal = new Date();
  const dataInicial = new Date();
  dataInicial.setDate(dataInicial.getDate() - LOOKBACK_DAYS);

  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES_ID}/dados` +
    `?formato=json&dataInicial=${formatBrDate(dataInicial)}&dataFinal=${formatBrDate(dataFinal)}`;
  const data = await fetchJson(url, { label: "BCB Selic", validate: validateBcbSeries });

  const observations = data
    .map((obs) => {
      const [day, month, year] = obs.data.split("/");
      return { date: `${year}-${month}-${day}`, value: parseFloat(obs.valor) };
    })
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!observations.length) throw new Error("BCB: no observations returned");

  const history = deriveHistory(observations);

  return [{
    countryCode: "BR",
    currentRate: history.currentRate,
    rateEffectiveDate: history.currentEffectiveDate,
    seedPreviousRate: history.previousRate,
    transitions: history.transitions,
    rateType: "Selic Target Rate",
    source: "bcb",
    sourceCadence: "daily",
  }];
}
