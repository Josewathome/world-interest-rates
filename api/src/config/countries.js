// Master list of tracked countries/currency areas.
// `source` names the sync module responsible for this row (see src/sources/*.js).
// `bisCode` is the BIS reference-area code, used both as the primary source for
// most countries and as the fallback backstop for the "fast lane" countries if
// their dedicated source fails on a given sync run.
// `currency` is the ISO 4217 code used to look up FX rates (frankfurter.dev);
// a handful of currencies (RUB, SAR, ARS, COP) aren't covered by that
// ECB-based source, so FX simply shows "—" for those.
export const COUNTRIES = [
  { code: "US", name: "United States", centralBank: "Federal Reserve", region: "Americas", tags: ["G20"], source: "fred", bisCode: "US", currency: "USD" },
  { code: "EA", name: "Euro Area", centralBank: "European Central Bank", region: "Europe", tags: ["G20"], source: "ecb", bisCode: "XM", currency: "EUR" },
  { code: "GB", name: "United Kingdom", centralBank: "Bank of England", region: "Europe", tags: ["G20"], source: "boe", bisCode: "GB", currency: "GBP" },
  // RBA only publishes a monthly-average CSV (lags real changes by weeks), so
  // BIS's daily series is actually fresher here — no dedicated "fast lane".
  { code: "AU", name: "Australia", centralBank: "Reserve Bank of Australia", region: "Oceania", tags: ["G20"], source: "bis", bisCode: "AU", currency: "AUD" },
  { code: "CA", name: "Canada", centralBank: "Bank of Canada", region: "Americas", tags: ["G20"], source: "boc", bisCode: "CA", currency: "CAD" },
  { code: "BR", name: "Brazil", centralBank: "Central Bank of Brazil", region: "Americas", tags: ["G20"], source: "bcb", bisCode: "BR", currency: "BRL" },

  { code: "JP", name: "Japan", centralBank: "Bank of Japan", region: "Asia", tags: ["G20"], source: "bis", bisCode: "JP", currency: "JPY" },
  { code: "CN", name: "China", centralBank: "People's Bank of China", region: "Asia", tags: ["G20"], source: "bis", bisCode: "CN", currency: "CNY" },
  { code: "IN", name: "India", centralBank: "Reserve Bank of India", region: "Asia", tags: ["G20"], source: "bis", bisCode: "IN", currency: "INR" },
  { code: "KR", name: "South Korea", centralBank: "Bank of Korea", region: "Asia", tags: [], source: "bis", bisCode: "KR", currency: "KRW" },
  { code: "ID", name: "Indonesia", centralBank: "Bank Indonesia", region: "Asia", tags: ["G20"], source: "bis", bisCode: "ID", currency: "IDR" },
  { code: "TR", name: "Turkey", centralBank: "Central Bank of the Republic of Turkey", region: "Europe", tags: ["G20"], source: "bis", bisCode: "TR", currency: "TRY" },
  { code: "RU", name: "Russia", centralBank: "Bank of Russia", region: "Europe", tags: ["G20"], source: "bis", bisCode: "RU", currency: "RUB" },
  { code: "SA", name: "Saudi Arabia", centralBank: "Saudi Central Bank (SAMA)", region: "Middle East", tags: ["G20"], source: "bis", bisCode: "SA", currency: "SAR" },
  { code: "MX", name: "Mexico", centralBank: "Bank of Mexico", region: "Americas", tags: ["G20"], source: "bis", bisCode: "MX", currency: "MXN" },
  { code: "ZA", name: "South Africa", centralBank: "South African Reserve Bank", region: "Africa", tags: ["G20"], source: "bis", bisCode: "ZA", currency: "ZAR" },
  { code: "CH", name: "Switzerland", centralBank: "Swiss National Bank", region: "Europe", tags: [], source: "bis", bisCode: "CH", currency: "CHF" },
  { code: "SE", name: "Sweden", centralBank: "Sveriges Riksbank", region: "Europe", tags: [], source: "bis", bisCode: "SE", currency: "SEK" },
  { code: "NO", name: "Norway", centralBank: "Norges Bank", region: "Europe", tags: [], source: "bis", bisCode: "NO", currency: "NOK" },
  { code: "PL", name: "Poland", centralBank: "National Bank of Poland", region: "Europe", tags: [], source: "bis", bisCode: "PL", currency: "PLN" },
  { code: "NZ", name: "New Zealand", centralBank: "Reserve Bank of New Zealand", region: "Oceania", tags: [], source: "bis", bisCode: "NZ", currency: "NZD" },
  { code: "AR", name: "Argentina", centralBank: "Central Bank of Argentina", region: "Americas", tags: ["G20"], source: "bis", bisCode: "AR", currency: "ARS" },
  { code: "IL", name: "Israel", centralBank: "Bank of Israel", region: "Middle East", tags: [], source: "bis", bisCode: "IL", currency: "ILS" },
  { code: "HK", name: "Hong Kong", centralBank: "Hong Kong Monetary Authority", region: "Asia", tags: [], source: "bis", bisCode: "HK", currency: "HKD" },
  { code: "TH", name: "Thailand", centralBank: "Bank of Thailand", region: "Asia", tags: [], source: "bis", bisCode: "TH", currency: "THB" },
  { code: "PH", name: "Philippines", centralBank: "Bangko Sentral ng Pilipinas", region: "Asia", tags: [], source: "bis", bisCode: "PH", currency: "PHP" },
  { code: "CO", name: "Colombia", centralBank: "Banco de la República", region: "Americas", tags: [], source: "bis", bisCode: "CO", currency: "COP" },
];

export const COUNTRIES_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
