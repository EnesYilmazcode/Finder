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

function render(data) {
  const series = fillDays(data.daily, data.days, data.since);
  const peak = series.reduce((a, b) => (b.views > a.views ? b : a), series[0]);

  $('t-views').textContent = nf.format(data.totals.views);
  $('t-visitors').textContent = nf.format(data.totals.visitors);
  $('t-peak').textContent = nf.format(peak.views);
  $('t-peak-day').textContent = peak.views ? shortDay(peak.day) : '';
  $('t-countries').textContent = nf.format(data.countries.length);

  drawChart(series);
  drawList('l-paths', data.paths, (p) => p);
  drawList('l-countries', data.countries, countryName);
  drawList('l-referrers', data.referrers, (r) => r);

  $('stamp').textContent = `Updated ${new Date(data.generated).toLocaleString()}. Counts can lag by up to two minutes.`;
  $('status').hidden = true;
  $('main').hidden = false;
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
