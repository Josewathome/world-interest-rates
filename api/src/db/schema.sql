CREATE TABLE IF NOT EXISTS rates (
  country_code TEXT PRIMARY KEY,
  country_name TEXT NOT NULL,
  central_bank_name TEXT NOT NULL,
  region TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  rate_type TEXT,
  current_rate REAL,
  previous_rate REAL,
  change_bps REAL,
  rate_effective_date TEXT,
  -- JSON array of {date, value} step-change points from source history,
  -- refreshed on every sync — used for the sparkline and change-streak.
  -- Purely informational: never used to derive current/previous_rate above.
  transitions TEXT NOT NULL DEFAULT '[]',
  next_meeting_date TEXT,
  source TEXT,
  source_cadence TEXT,
  currency_code TEXT,
  -- Inflation columns are only ever populated for the handful of countries
  -- with a confirmed-fresh free source (see src/sources/inflation.js).
  -- inflation_period is the CPI reference month, not today — always show it
  -- alongside the rate so the UI never implies same-day freshness.
  inflation_rate REAL,
  inflation_period TEXT,
  inflation_source TEXT,
  fx_rate REAL,
  fx_rate_date TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL,
  old_rate REAL,
  new_rate REAL,
  change_bps REAL,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  countries_updated INTEGER DEFAULT 0,
  ran_at TEXT NOT NULL
);
