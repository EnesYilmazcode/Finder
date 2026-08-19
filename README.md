# Finder

Find who teaches your classes before everyone else.

**Live: https://enesyilmazcode.github.io/Finder/**

Ohio State's own class search will tell you a course exists. It is far less
helpful when the question you actually have is "which of these six sections
should I take, and who is teaching them." Finder answers that one instead:
search a course, and get its sections grouped by **instructor**, with live seat
status and RateMyProfessors ratings next to each name.

## Why this exists

[osucoursesearch.org](https://osucoursesearch.org) did roughly this job and went
down. Its database container stopped resolving and its author moved on, so the
site now serves a Django stack trace instead of course data.

Finder is a fresh build with a different failure model. There is no server and no
database, so there is no equivalent thing to go down.

## How it works

```
Browser  ->  content.osu.edu/v2   live sections, instructors, seats
Browser  ->  data/ratings.json    nightly RateMyProfessors snapshot
GitHub Pages                      serves the page and the snapshot
```

Course data is read straight from OSU's public class API at request time, so it is
never stale. That API sends `Access-Control-Allow-Origin: *`, which is what makes a
serverless build possible.

Ratings are the one thing a browser cannot fetch directly, because
RateMyProfessors sends no CORS headers. Rather than stand up a proxy for it, a
scheduled GitHub Action snapshots the Ohio State roster into `data/ratings.json`
and commits it. Ratings move slowly enough that a nightly snapshot costs nothing.

See [docs/osu-api.md](docs/osu-api.md) for the API details.

## Running it locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly off the
filesystem will not work, because `file://` pages cannot make cross-origin
requests.

To refresh ratings yourself:

```bash
node scripts/fetch-ratings.mjs
```

## Data sources

| Data | Source | Freshness |
|---|---|---|
| Courses, sections, instructors, seats | `content.osu.edu/v2` | live |
| Professor ratings | RateMyProfessors | nightly snapshot |

Finder is not affiliated with or endorsed by The Ohio State University.

## License

MIT. See [LICENSE](LICENSE).
