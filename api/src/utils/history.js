// Given a chronologically-ascending list of {date, value} observations,
// collapses runs of repeated values down to just the points where the rate
// actually changed (plus the earliest known point as a starting anchor).
// This is what a policy rate's real shape looks like — a step function, not
// a continuously wiggling line — and it's compact enough to ship in every
// API response for a sparkline (typically 2-15 points, even over years).
export function extractTransitions(observations) {
  if (!observations.length) return [];
  const out = [{ date: observations[0].date, value: observations[0].value }];
  for (let i = 1; i < observations.length; i++) {
    if (observations[i].value !== out[out.length - 1].value) {
      out.push({ date: observations[i].date, value: observations[i].value });
    }
  }
  return out;
}

// How many consecutive moves in the same direction led up to the latest
// transition — e.g. {count: 3, direction: "cut"} for a 3rd straight cut.
// Needs at least two transitions (one real change) to say anything.
export function computeStreak(transitions) {
  if (!transitions || transitions.length < 2) return null;

  const dirOf = (i) => Math.sign(transitions[i].value - transitions[i - 1].value);
  const lastDir = dirOf(transitions.length - 1);
  if (lastDir === 0) return null;

  let count = 1;
  for (let i = transitions.length - 2; i >= 1; i--) {
    if (dirOf(i) === lastDir) count++;
    else break;
  }
  return { count, direction: lastDir > 0 ? "hike" : "cut" };
}

// Derives everything a source needs from a raw observation series: the
// current rate, when it actually took effect (not just "latest data point"),
// the previous distinct rate, and the full transition list for sparklines.
export function deriveHistory(observations) {
  const transitions = extractTransitions(observations);
  const last = transitions[transitions.length - 1];

  if (transitions.length < 2) {
    // Flat for the entire lookback window — we only know it was already at
    // this value on the earliest date we looked at, not when it truly started.
    return { currentRate: last.value, currentEffectiveDate: last.date, previousRate: null, transitions };
  }

  const prev = transitions[transitions.length - 2];
  return {
    currentRate: last.value,
    currentEffectiveDate: last.date,
    previousRate: prev.value,
    transitions,
  };
}
