import { ANALYTICS, configured } from './analytics.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');

let regions;
try {
  regions = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regions = null;
}

function countryName(code) {
  if (!code || code === 'XX') return 'Unknown';
  if (code === 'T1') return 'Tor network';
  try {
    return regions?.of(code) || code;
  } catch {
    return code;
  }
}

function shortDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// The worker only returns days that saw traffic, so gaps are filled here to
// keep the chart's x-axis evenly spaced.
function fillDays(daily, days, since) {
  const seen = new Map(daily.map((r) => [r.day, r]));
  const start = new Date(`${since}T00:00:00Z`);
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    out.push(seen.get(day) || { day, views: 0, visitors: 0 });
  }
  return out;
}

function drawChart(series) {
  const max = Math.max(1, ...series.map((r) => r.views));
  $('chart').replaceChildren(...series.map((r) => {
    const bar = document.createElement('div');
    bar.className = r.views ? 'bar' : 'bar zero';
    bar.style.height = r.views ? `${Math.max(2, (r.views / max) * 100)}%` : '2px';
    bar.title = `${shortDay(r.day)}: ${nf.format(r.views)} views, ${nf.format(r.visitors)} visitors`;
    return bar;
  }));
  $('ax-from').textContent = shortDay(series[0].day);
  $('ax-to').textContent = shortDay(series[series.length - 1].day);
}

function drawList(id, rows, label) {
  const el = $(id);
  if (!rows.length) {
    el.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'empty', textContent: 'Nothing yet.',
    }));
    return;
  }
  const top = rows[0].views || 1;
  el.replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    li.style.setProperty('--share', `${(r.views / top) * 100}%`);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label(r.name);
    name.title = label(r.name);

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = nf.format(r.views);

    li.append(name, n);
    return li;
  }));
}

function when(ts) {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function drawRecent(rows) {
  const dash = (v) => v || '–';
  $('l-recent').replaceChildren(...rows.map((r) => {
    const place = r.city
      ? [r.city, r.region, r.country].filter(Boolean).join(', ')
      : countryName(r.country);
    const device = [r.device, r.os, r.browser].filter(Boolean).join(' · ');
    const tr = document.createElement('tr');
    // Same six characters on two rows means the same browser.
    const who = r.who ? (r.days_seen > 1 ? `${r.who} · ${r.days_seen} days` : r.who) : '–';
    for (const text of [when(r.ts), who, r.path, place, dash(r.org), dash(device), dash(r.ref)]) {
      const td = document.createElement('td');
      td.textContent = text;
      td.title = text;
      tr.append(td);
    }
    return tr;
  }));
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.append(Object.assign(document.createElement('td'), { colSpan: 7, className: 'empty', textContent: 'Nothing yet.' }));
    $('l-recent').replaceChildren(tr);
  }
}

function render(data) {
  const series = fillDays(data.daily, data.days, data.since);
  const peak = series.reduce((a, b) => (b.views > a.views ? b : a), series[0]);

  $('t-views').textContent = nf.format(data.totals.views);
  $('t-visitors').textContent = nf.format(data.totals.visitors);
  $('t-peak').textContent = nf.format(peak.views);
  $('t-peak-day').textContent = peak.views ? shortDay(peak.day) : '';
  $('t-returning').textContent = nf.format(data.totals.returning || 0);
  $('t-countries').textContent = nf.format(data.countries.length);

  drawChart(series);
  drawList('l-paths', data.paths, (p) => p);
  drawList('l-countries', data.countries, countryName);
  drawList('l-referrers', data.referrers, (r) => r);
  // Older workers and rows from before 2026-10-25 have none of these fields.
  drawList('l-cities', data.cities || [], (c) => c);
  drawList('l-networks', data.networks || [], (o) => o);
  drawList('l-browsers', data.browsers || [], (b) => b);
  drawList('l-systems', data.systems || [], (o) => o);
  drawList('l-devices', data.devices || [], (d) => d);
  drawRecent(data.recent || []);

  $('stamp').textContent = `Updated ${new Date(data.generated).toLocaleString()}. Counts can lag by up to two minutes.`;
  $('status').hidden = true;
  $('main').hidden = false;

  // Long ranges scroll, and their oldest days are the empty ones, so open on
  // the newest bars. After the unhide, or there is no width to scroll yet.
  $('chart').scrollLeft = $('chart').scrollWidth;
}

async function load(days) {
  $('status').hidden = false;
  $('status').textContent = 'Loading…';
  try {
    const res = await fetch(`${ANALYTICS}/stats.json?days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (err) {
    $('main').hidden = true;
    $('status').textContent = `Could not load the numbers (${err.message}).`;
  }
}

$('ranges').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-days]');
  if (!button) return;
  for (const b of $('ranges').querySelectorAll('button')) {
    b.classList.toggle('on', b === button);
    b.toggleAttribute('aria-current', b === button);
  }
  load(button.dataset.days);
});

if (configured) {
  load(30);
} else {
  $('status').textContent = 'Analytics endpoint is not configured yet.';
}
