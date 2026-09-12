// Bank of England Interactive Statistical Database (IADB) — free, no key,
// but a legacy CSV-over-querystring export rather than a modern REST API.
// Series IUDBEDR = Bank of England Official Bank Rate.
import { deriveHistory } from "../utils/history.js";

const SERIES_CODE = "IUDBEDR";

function parseDdMonYyyy(str) {
  // "10 Sep 2026" -> "2026-09-10"
  const [day, monStr, year] = str.trim().split(/\s+/);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months.indexOf(monStr) + 1;
  if (!month) return null;
  return `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function fetchBoe() {
  // Wide range so we can find the actual last rate change, not just today's
  // re-published figure.
  const url = "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" +
    `?csv.x=yes&Datefrom=01/Jan/2023&Dateto=now&SeriesCodes=${SERIES_CODE}&UsingCodes=Y&CSVF=TT&VPD=Y&VFD=N`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BoE HTTP ${res.status}`);
  const text = await res.text();

  const observations = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{1,2} [A-Za-z]{3} \d{4},[\d.]+$/.test(l))
    .map((line) => {
      const [dateStr, valueStr] = line.split(",");
      return { date: parseDdMonYyyy(dateStr), value: parseFloat(valueStr) };
    })
    .filter((o) => o.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!observations.length) throw new Error("BoE: no data rows parsed");

  const history = deriveHistory(observations);

  return [{
    countryCode: "GB",
    currentRate: history.currentRate,
    rateEffectiveDate: history.currentEffectiveDate,
    seedPreviousRate: history.previousRate,
    transitions: history.transitions,
    rateType: "Official Bank Rate",
    source: "boe",
    sourceCadence: "daily",
  }];
}
