// Finder's own analytics collector. /hit takes one beacon per page load from the site,
// /stats.json hands back aggregates for the public dashboard at /Finder/stats.

const SITE = 'https://enesyilmazcode.github.io';

// A visitor is their browser id when the beacon sent one, otherwise the daily hash.
const WHO = "COALESCE(NULLIF(vid, ''), visitor)";

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python-requests|axios|monitor|pingdom|uptime|semrush|ahrefs/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request, url) });
    }
    if (url.pathname === '/hit' && request.method === 'POST') {
      return collect(request, env);
    }
    if (url.pathname === '/stats.json' && request.method === 'GET') {
      return stats(request, env, url);
    }
    return new Response('finder-analytics\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

function cors(request, url) {
  // The dashboard is public, so reads are open. Writes are not.
  if (url.pathname === '/stats.json') {
    return {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    };
  }
  const origin = request.headers.get('origin') === SITE ? SITE : 'null';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
  };
}

async function collect(request, env) {
  const headers = cors(request, new URL(request.url));
  // Always answer 204 so a rejected hit looks the same as a counted one.
  const ok = () => new Response(null, { status: 204, headers });

  if (request.headers.get('origin') !== SITE) return ok();

  const ua = request.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return ok();

  // Refuse to store anything rather than fall back to a public, guessable salt.
  if (!env.SALT) throw new Error('SALT secret is not set');

  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 2000));
  } catch {
    return ok();
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';

  // Cloudflare geolocates every request at the edge. The IP itself is still
  // only used for the hash, never stored.
  const cf = request.cf || {};
  const agent = parseAgent(ua);

  await env.DB.prepare(
    `INSERT INTO hits (ts, day, path, country, ref, visitor, city, region, org, asn, browser, os, device, vid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    Math.floor(now.getTime() / 1000),
    day,
    cleanPath(body.p),
    cf.country || 'XX',
    refHost(body.r),
    await visitorHash(`${env.SALT}|${day}|${ip}|${ua}`),
    (cf.city || '').slice(0, 80),
    (cf.regionCode || cf.region || '').slice(0, 80),
    (cf.asOrganization || '').slice(0, 120),
    Number(cf.asn) || 0,
    agent.browser,
    agent.os,
    agent.device,
    cleanVid(body.v)
  ).run();

  return ok();
}

async function stats(request, env, url) {
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 365);
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

  const q = (sql) => env.DB.prepare(sql).bind(since);
  const [totals, daily, countries, paths, referrers, cities, networks, browsers, systems, devices, recent, returning] = await env.DB.batch([
    q(`SELECT COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ?`),
    q(`SELECT day, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? GROUP BY day ORDER BY day`),
    q(`SELECT country AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? GROUP BY country ORDER BY views DESC LIMIT 25`),
    q(`SELECT path AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 25`),
    q(`SELECT ref AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? AND ref != '' GROUP BY ref ORDER BY views DESC LIMIT 25`),
    q(`SELECT city || ', ' || CASE WHEN region != '' THEN region || ', ' ELSE '' END || country AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? AND city != '' GROUP BY name ORDER BY views DESC LIMIT 25`),
    q(`SELECT org AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? AND org != '' GROUP BY org ORDER BY views DESC LIMIT 25`),
    q(`SELECT browser AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? AND browser != '' GROUP BY browser ORDER BY views DESC LIMIT 25`),
    q(`SELECT os AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? AND os != '' GROUP BY os ORDER BY views DESC LIMIT 25`),
    q(`SELECT device AS name, COUNT(*) AS views, COUNT(DISTINCT ${WHO}) AS visitors FROM hits WHERE day >= ? AND device != '' GROUP BY device ORDER BY views DESC LIMIT 25`),
    q("SELECT ts, path, ref, country, city, region, org, asn, browser, os, device, substr(vid, 1, 6) AS who, (SELECT COUNT(DISTINCT h2.day) FROM hits h2 WHERE h2.vid = hits.vid AND hits.vid != '') AS days_seen FROM hits WHERE day >= ? ORDER BY ts DESC LIMIT 50"),
    q("SELECT COUNT(*) AS n FROM (SELECT vid FROM hits WHERE day >= ? AND vid != '' GROUP BY vid HAVING COUNT(DISTINCT day) > 1)"),
  ]);

  return Response.json({
    days,
    since,
    generated: new Date().toISOString(),
    totals: { ...(totals.results[0] || { views: 0, visitors: 0 }), returning: returning.results[0]?.n || 0 },
    daily: daily.results,
    countries: countries.results,
    paths: paths.results,
    referrers: referrers.results,
    cities: cities.results,
    networks: networks.results,
    browsers: browsers.results,
    systems: systems.results,
    devices: devices.results,
    recent: recent.results,
  }, {
    headers: { ...cors(request, url), 'cache-control': 'public, max-age=120' },
  });
}

function cleanPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  return raw.split(/[?#]/)[0].slice(0, 200);
}

function cleanVid(raw) {
  return typeof raw === 'string' && /^[0-9a-f-]{36}$/.test(raw) ? raw : '';
}

function refHost(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const host = new URL(raw).host;
    return host === new URL(SITE).host ? '' : host.slice(0, 100);
  } catch {
    return '';
  }
}

// Major browser, OS and form factor from the user-agent string. Order matters:
// Edge and Opera also say Chrome, and Chrome also says Safari.
function parseAgent(ua) {
  const ver = (re) => (ua.match(re) || [])[1] || '';
  let browser = '';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = `Edge ${ver(/Edg(?:e|A|iOS)?\/(\d+)/)}`;
  else if (/OPR\/|Opera/.test(ua)) browser = `Opera ${ver(/OPR\/(\d+)/)}`;
  else if (/SamsungBrowser\//.test(ua)) browser = `Samsung Internet ${ver(/SamsungBrowser\/(\d+)/)}`;
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = `Firefox ${ver(/(?:Firefox|FxiOS)\/(\d+)/)}`;
  else if (/CriOS\/|Chrome\//.test(ua)) browser = `Chrome ${ver(/(?:CriOS|Chrome)\/(\d+)/)}`;
  else if (/Safari\//.test(ua)) browser = `Safari ${ver(/Version\/(\d+)/)}`;
  else browser = 'Other';

  let os = 'Other';
  if (/iPhone/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let device = 'Desktop';
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'Tablet';
  else if (/Mobi|iPhone/.test(ua)) device = 'Phone';

  return { browser: browser.trim(), os, device };
}

async function visitorHash(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
