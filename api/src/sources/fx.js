// frankfurter.dev — free, no key, ECB reference rates (updated once daily,
// business days only; frankfurter.app now 301-redirects here). One request
// covers every currency at once, so this is cheap regardless of how many
// countries we track.
//
// Note: ECB doesn't publish reference rates for every currency — RUB, SAR,
// ARS and COP aren't covered, so those countries simply show no FX rate.
import { COUNTRIES } from "../config/countries.js";

export async function fetchFx() {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD");
  if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
  const data = await res.json();
  const rates = data.rates || {};
  const date = data.date;

  const results = [];
  for (const country of COUNTRIES) {
    if (country.currency === "USD") {
      results.push({ countryCode: country.code, fxRate: 1, fxRateDate: date });
      continue;
    }
    const rate = rates[country.currency];
    if (rate !== undefined) {
      results.push({ countryCode: country.code, fxRate: rate, fxRateDate: date });
    }
  }
  return results;
}
