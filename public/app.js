const REFRESH_INTERVAL_MS = 60_000;

let rates = [];
let activeFilter = { type: "region", value: "All" };

function flagEmoji(code) {
  if (code === "EA") return "🇪🇺";
  const base = 0x1f1e6;
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(base + (c.charCodeAt(0) - 65)))
    .join("");
}

function formatRate(value) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)}%`;
}

function formatChange(bps) {
  if (bps === null || bps === undefined) return { text: "—", cls: "flat" };
  if (bps === 0) return { text: "0 bps", cls: "flat" };
  const cls = bps > 0 ? "up" : "down";
  const arrow = bps > 0 ? "▲" : "▼";
  return { text: `${arrow} ${Math.abs(bps)} bps`, cls };
}

function formatDaysSince(dateStr) {
  if (!dateStr) return "—";
  const then = new Date(`${dateStr}T00:00:00Z`).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 0) return "—"; // guard against a forward-dated effective date
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

const ORDINALS = ["0th", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

function formatStreak(streak) {
  if (!streak) return "";
  const ordinal = ORDINALS[streak.count] || `${streak.count}th`;
  return `${ordinal} straight ${streak.direction}`;
}

// Renders a small step-chart sparkline: the rate only ever moves in
// discrete jumps, so a step line is the honest shape (not a smoothed curve).
function renderSparkline(transitions) {
  const width = 90;
  const height = 28;
  const pad = 3;

  if (!transitions || transitions.length === 0) {
    return `<span class="sparkline-empty">—</span>`;
  }

  const dates = transitions.map((t) => new Date(`${t.date}T00:00:00Z`).getTime());
  const values = transitions.map((t) => t.value);
  const today = Date.now();
  const minDate = dates[0];
  const maxDate = Math.max(today, dates[dates.length - 1]);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal || 1;

  const xScale = (d) => pad + ((d - minDate) / (maxDate - minDate || 1)) * (width - 2 * pad);
  const yScale = (v) => height - pad - ((v - minVal) / valRange) * (height - 2 * pad);

  const pts = [{ x: xScale(dates[0]), y: yScale(values[0]) }];
  for (let i = 1; i < transitions.length; i++) {
    const x = xScale(dates[i]);
    pts.push({ x, y: yScale(values[i - 1]) }); // hold old value up to this date
    pts.push({ x, y: yScale(values[i]) }); // jump to the new value
  }
  pts.push({ x: xScale(today), y: yScale(values[values.length - 1]) }); // hold current value up to now

  const points = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

function formatInflationPeriod(period) {
  if (!period) return "";
  const [y, m] = period.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = parseInt(m, 10) - 1;
  return months[mi] ? `${months[mi]} ${y}` : period;
}

function formatRealRate(value) {
  if (value === null || value === undefined) return { text: "—", cls: "flat" };
  const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return { text: `${value > 0 ? "+" : ""}${value.toFixed(2)}%`, cls };
}

function formatCountdown(dateStr) {
  if (!dateStr) return { text: "—", imminent: false };
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = Date.now();
  const diffMs = target - now;
  if (diffMs <= 0) return { text: "Today / passed", imminent: true };

  const hours = diffMs / 36e5;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return { text: `${h}h ${m}m`, imminent: true };
  }
  const days = Math.floor(hours / 24);
  return { text: `${days} day${days === 1 ? "" : "s"}`, imminent: days <= 2 };
}

function render() {
  const tbody = document.getElementById("rates-body");
  const filtered = rates.filter((r) => {
    if (activeFilter.type === "region") {
      return activeFilter.value === "All" || r.region === activeFilter.value;
    }
    return r.tags.includes(activeFilter.value);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty-state">No data for this filter yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((r) => {
      const change = formatChange(r.change_bps);
      const countdown = formatCountdown(r.next_meeting_date);
      const streakText = formatStreak(r.streak);
      const realRate = formatRealRate(r.real_rate);
      return `
        <tr>
          <td>
            <div class="country-cell">
              <span class="flag">${flagEmoji(r.country_code)}</span>
              <span class="country-name">${r.country_name}</span>
            </div>
          </td>
          <td class="bank-name">${r.central_bank_name}</td>
          <td class="rate-value">${formatRate(r.current_rate)}</td>
          <td class="rate-value muted">${formatRate(r.previous_rate)}</td>
          <td>
            <div class="change ${change.cls}">${change.text}</div>
            ${streakText ? `<div class="streak">${streakText}</div>` : ""}
          </td>
          <td>${renderSparkline(r.transitions)}</td>
          <td>
            <div>${r.rate_effective_date || "—"}</div>
            <div class="days-since">${formatDaysSince(r.rate_effective_date)}</div>
          </td>
          <td class="countdown ${countdown.imminent ? "imminent" : ""}">${countdown.text}</td>
          <td>
            <div>${formatRate(r.inflation_rate)}</div>
            ${r.inflation_period ? `<div class="days-since">${formatInflationPeriod(r.inflation_period)}</div>` : ""}
          </td>
          <td class="change ${realRate.cls}">${realRate.text}</td>
          <td>
            <div>${r.fx_rate ? `${r.fx_rate.toFixed(2)} ${r.currency_code}` : "—"}</div>
            ${r.fx_rate_date ? `<div class="days-since">${r.fx_rate_date}</div>` : ""}
          </td>
          <td><span class="source-tag">${r.source || "—"}</span></td>
        </tr>`;
    })
    .join("");
}

async function loadRates() {
  try {
    // No separate token fetch needed — the browser automatically attaches
    // the signed cookie set on page load (server.js's issueCookie), and each
    // successful response renews it for the next poll.
    const res = await fetch("/w/f");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    rates = data.d;
    document.getElementById("last-updated").textContent =
      `Last synced: ${new Date().toLocaleTimeString()}`;
    render();
  } catch (err) {
    document.getElementById("last-updated").textContent = "Failed to load data";
    console.error(err);
  }
}

document.getElementById("region-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  activeFilter = btn.dataset.region
    ? { type: "region", value: btn.dataset.region }
    : { type: "tag", value: btn.dataset.tag };
  render();
});

document.getElementById("refresh-btn").addEventListener("click", loadRates);

loadRates();
setInterval(loadRates, REFRESH_INTERVAL_MS);
// Re-render every 30s even without a new fetch, so meeting countdowns tick.
setInterval(render, 30_000);
