# finder-analytics

The counter behind [/Finder/stats](https://enesyilmazcode.github.io/Finder/stats/).
A single Cloudflare Worker with a D1 database. No third-party analytics service
is involved, and no IP address ever reaches storage.

## Routes

- `POST /hit` — one beacon per page load, sent by `js/hit.js`. Rejects anything
  whose `Origin` is not the site, and drops known bots. Always answers `204` so
  a dropped hit looks the same as a counted one.
- `GET /stats.json?days=30` — public aggregates for the dashboard.

## How a visitor is counted

`js/hit.js` keeps a random id in `localStorage` (`finder-v`) and sends it with
each beacon, so someone who comes back next week is still one visitor. When
storage is blocked there is no id, and the worker falls back to
`SHA-256(salt + day + ip + user-agent)`, truncated, which rotates every midnight
UTC. The worker refuses to store hits if the `SALT` secret is missing.

Each row also carries city, region and network (`request.cf`, Cloudflare's guess
from the connection) and browser, OS and device parsed from the user-agent. The
IP itself is only ever an input to the hash.

## Deploy

```sh
cd analytics
npx wrangler login
npx wrangler d1 create finder-analytics       # paste database_id into wrangler.toml
npx wrangler d1 execute finder-analytics --remote --file=schema.sql
# an existing database from before 2026-10-27 needs migrate-2026-10-27.sql instead
npx wrangler secret put SALT                  # any long random string
npx wrangler deploy
```

`wrangler deploy` prints the worker URL. It goes in `js/analytics.js`.

## Local development

```sh
npx wrangler d1 execute finder-analytics --local --file=schema.sql
npx wrangler dev
```

Point `ANALYTICS` in `js/analytics.js` at `http://127.0.0.1:8787` while testing,
and remember to put it back.
