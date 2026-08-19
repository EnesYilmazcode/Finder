// Finder's own analytics collector. Two routes: /hit takes one beacon from the
// site, /stats.json hands back aggregates for the public dashboard.

const SITE = 'https://enesyilmazcode.github.io';

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
  // The dashboard is meant to be shared, so reads are open. Writes are not.
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
  // Always answer 204 so a rejected hit is indistinguishable from a counted one
  // and never shows up as an error in a visitor's console.
  const ok = () => new Response(null, { status: 204, headers });

  if (request.headers.get('origin') !== SITE) return ok();

  const ua = request.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return ok();

  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 2000));
  } catch {
    return ok();
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const salt = env.SALT || 'finder-unsalted';

  await env.DB.prepare(
    'INSERT INTO hits (ts, day, path, country, ref, visitor) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    Math.floor(now.getTime() / 1000),
    day,
    cleanPath(body.p),
    request.cf?.country || 'XX',
    refHost(body.r),
    await visitorHash(`${salt}|${day}|${ip}|${ua}`)
  ).run();

  return ok();
}

async function stats(request, env, url) {
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 365);
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

  const q = (sql) => env.DB.prepare(sql).bind(since);
  const [totals, daily, countries, paths, referrers] = await env.DB.batch([
    q('SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM hits WHERE day >= ?'),
    q('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM hits WHERE day >= ? GROUP BY day ORDER BY day'),
    q('SELECT country AS name, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM hits WHERE day >= ? GROUP BY country ORDER BY views DESC LIMIT 25'),
    q('SELECT path AS name, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM hits WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 25'),
    q("SELECT ref AS name, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM hits WHERE day >= ? AND ref != '' GROUP BY ref ORDER BY views DESC LIMIT 25"),
  ]);

  return Response.json({
    days,
    since,
    generated: new Date().toISOString(),
    totals: totals.results[0] || { views: 0, visitors: 0 },
    daily: daily.results,
    countries: countries.results,
    paths: paths.results,
    referrers: referrers.results,
  }, {
    headers: { ...cors(request, url), 'cache-control': 'public, max-age=120' },
  });
}

function cleanPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  return raw.split(/[?#]/)[0].slice(0, 200);
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

async function visitorHash(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
