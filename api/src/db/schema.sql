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
  -- Market-implied rate-expectation fields (see src/sources/rateExpectations.js)
  -- — currently US-only, since 30-Day Fed Funds futures are the one globally
  -- liquid, freely-accessible instrument this can be computed from. Built on
  -- an unofficial data source (Yahoo Finance's undocumented chart API), so
  -- expectations_stale flags when the underlying futures price hasn't moved
  -- in 3+ sessions — treat those rows with caution rather than as fact.
  expected_meeting_date TEXT,
  expected_change_bps REAL,
  expected_post_meeting_rate REAL,
  expected_hold_pct REAL,
  expected_cut_pct REAL,
  expected_hike_pct REAL,
  expected_cut_pct_change_1d REAL,
  expectations_stale INTEGER,
  -- Why expectations_stale is true: "unchanged_days" (see the two _unchanged_
  -- columns below for how long) or "low_volume". Null when not stale.
  expectations_stale_reason TEXT,
  -- The last date the underlying futures price actually changed, found by
  -- walking back up to 35 days (see rateExpectations.js) — not just "was it
  -- flat for the last few days".  _is_lower_bound means the price was flat
  -- across the entire lookback window, so this date is our earliest evidence,
  -- not necessarily the true start.
  expectations_unchanged_since TEXT,
  expectations_unchanged_days INTEGER,
  expectations_unchanged_is_lower_bound INTEGER,
  expectations_source TEXT,
  expectations_updated_at TEXT,
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
