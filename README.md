# Finder

Find who teaches your classes before everyone else.

**Live: https://enesyilmazcode.github.io/Finder/**

Ohio State's own class search will tell you a course exists. It is far less
helpful when the question you actually have is "which of these six sections
should I take, and who is teaching them." Finder answers that one instead:
search a course, and get its sections grouped by **instructor**, with per-section
seat counts and RateMyProfessors ratings next to each name.

## Why this exists

[osucoursesearch.org](https://osucoursesearch.org) did roughly this job and went
down. Its database container stopped resolving and its author moved on, so the
site now serves a Django stack trace instead of course data.

Finder is a fresh build with a different failure model. It is a static site with
no server and no database, so there is no equivalent thing to go down. The data a
browser cannot fetch for itself is snapshotted into the repo by GitHub Actions
and served as plain files.

## What the interface is

Three panes at desktop width, collapsing to one column under 64rem.

```
+-----------------------------------------------------------------------+
| Finder           [ CSE 2221              ] [ Autumn 2026 v] [ Search ] |
+--------------+----------------------------------------+---------------+
| FIND A COURSE|  [ List ] [ Calendar ]                  | Section 5168  |
|  subject     |                                         | Paolo Bucci   |
|  number      |  CSE 2221  Software I: Software         |  3.0    4.1   |
|              |            Components  4 credits, 22    | 147 ratings   |
| MEETS ON     |                                         |               |
|  Mo Tu We .. |    Paolo Bucci  3.0 (147)               | SEATS         |
| TIME OF DAY  |      5168  TuTh 8:00a  Dreese    32/40  |  [======    ] |
| INSTRUCTOR   |      5169  WeFr 8:00a  Dreese    32/40  |  32 / 40      |
|  min rating  |                                         |  no waitlist  |
|  rated only  |    KT Vandergriff  2.7 (57)             |  as of Aug 18 |
| AVAILABILITY |      4827  TuTh 9:10a  Dreese    40/40  | MEETS         |
|  hide full   |      4828  WeFr 9:10a  Dreese    40/40  | ALSO TEACHES  |
|  hide online |                                         | ABOUT         |
|              |  > Show related courses                 |               |
+--------------+----------------------------------------+---------------+
```

- **Filter rail.** Subject and course-number pickers, plus filters for days, time
  of day, minimum rating, rated instructors only, hide full, hide online. Every
  filter runs client side over results already fetched, so nothing refetches and
  nothing hits OSU. Filters live in the URL, so a filtered view reloads and
  shares. Nothing is hidden silently: whatever a filter removed is counted and
  offered back with a "Show them anyway" button.
- **Centre column.** List view groups a course's sections by who teaches them.
  Calendar view plots the same sections on a week grid, collapsing sections that
  share a day and time into one block naming every instructor, since comparing
  instructors is the point and slicing a column three ways is unreadable. There
  is no saved schedule and no conflict detection. Finder searches, it does not
  plan.
- **Detail pane.** Instructor, rating, difficulty, would-take-again, seats with
  waitlist, meeting pattern and room, the other sections that instructor teaches
  within the current results, and the course description. Nothing in this pane
  fetches, because everything it needs is already loaded by the time a section
  can be clicked.

Collapsed to one column, the rail becomes a sheet behind a Filters button and
the detail pane takes over the screen, with focus moving to it and back.

## What the data actually is

| Data | Source | Fetched | Freshness |
|---|---|---|---|
| Courses, sections, instructors, meeting times | `content.osu.edu/v2` | browser, per search | live |
| Per-section seats, limits, waitlists | Barrett's schedule | CI, `data/seats.json` | daily snapshot |
| Professor ratings | RateMyProfessors | CI, `data/ratings.json` | nightly snapshot |
| Subject and course index for the pickers | `content.osu.edu/v2` | CI, `data/courses.json` | weekly rebuild |

Sections, instructors and meeting times are read straight from OSU's public class
API at request time, so they are never stale. That API sends
`Access-Control-Allow-Origin: *`, which is what makes a serverless build
possible. See [docs/osu-api.md](docs/osu-api.md).

### OSU's API reports enrollment wrong per section

The search endpoint returns one `enrollmentTotal` per course and repeats it onto
every section, and it exposes no per-section limit at all. For CSE 2221 in Autumn
2026 it calls all 22 sections "Open" with 32 enrolled. 18 of those 22 are full.
Class 4831 is 41/40 with one person waiting, and the API calls it open.

That is why seats do not come from the API. Barrett's schedule publishes a plain
text file per subject carrying real per-section enrolled, limit and waitlist
figures. `asc.ohio-state.edu` sends no CORS headers, so a browser cannot read it
and the fetch runs in Actions instead. The parser slices fixed-width columns,
then blanks them and asserts nothing but whitespace is left over, and refuses to
write if more than 0.5% of lines fail that check. The last full run parsed 17680
section lines for term 1268 with zero residue. Format notes are in
[docs/barrett-schedule.md](docs/barrett-schedule.md).

Barrett is a nightly batch built around 06:50 Eastern, so **seats are a daily
snapshot, not live**. The status line and the detail pane both say which day the
numbers are from. Barrett also lists fewer sections than the API, 484 for CSE in
Autumn 2026 against the 1064 the API reports, so a class number that is absent
renders as unknown and never as zero. Seats are withheld entirely when the loaded snapshot covers a
different term than the one selected, since showing Autumn seats against a Spring
section would be confidently wrong.

### Most instructors are not on RateMyProfessors

Only about **36% of instructors are on RateMyProfessors**, measured across 757
instructors in 8 subjects for Autumn 2026. The unrated case is the common one, so
it costs nothing visually: the instructor's name is the link either way, to their
profile when there is a match and to an RMP search when there is not.

Matching is on first and last name with middle names and generational suffixes
stripped, plus a surname fallback that accepts a first-name prefix or, when the
surname is unique, a shared initial. That is what turns "Steve Gomori" into
Stephen Gomori and "Timothy Ellis Carpenter" into Tim Carpenter, and it took
coverage from 33% to 36%. When two professors share a first and last name the
lookup returns nothing rather than guessing, because a wrong rating is worse than
no rating. Rating counts always render, and anything under five ratings is marked
as thin evidence.

### The course index loads lazily, the other two do not

Ratings and seats are needed to render any result at all, so both start
downloading on page load. The course index behind the subject and number pickers
is only needed once someone opens a picker, so it loads on first focus instead.
Gzipped, ratings and seats come to about 245 KB together; pulling the course
index up front as well would make it about 423 KB. Anyone who just types into the
search box never pays for the index.

## How it fits together

```
GitHub Actions                                          committed to the repo
  fetch-ratings.mjs  <- ratemyprofessors.com/graphql  -> data/ratings.json
  fetch-seats.mjs    <- asc.ohio-state.edu/barrett.3  -> data/seats.json
  fetch-courses.mjs  <- content.osu.edu/v2            -> data/courses.json

GitHub Pages serves index.html, css/, js/ and data/. No server, no database.

Browser
  |
  |-- content.osu.edu/v2/classes/searchableTermsV2   on load
  |-- data/ratings.json                              on load
  |-- data/seats.json                                on load
  |-- content.osu.edu/v2/classes/search              per search, up to 5 pages
  `-- data/courses.json                              on first picker focus
```

Nothing else leaves the page. Ranking, merging duplicate course records, grouping
by instructor, filtering, the calendar grid and the detail pane all run over
results already in memory.

## The three pipelines

Each one runs on a schedule, can be dispatched by hand, and commits only when its
file actually changed.

| Script | Workflow | Schedule | Writes |
|---|---|---|---|
| `scripts/fetch-ratings.mjs` | `.github/workflows/ratings.yml` | daily, 07:20 UTC | `data/ratings.json` |
| `scripts/fetch-seats.mjs` | `.github/workflows/seats.yml` | daily, 12:30 UTC | `data/seats.json` |
| `scripts/fetch-courses.mjs` | `.github/workflows/courses.yml` | weekly, Mondays 08:40 UTC | `data/courses.json` |

Seats run at 12:30 UTC because that is after Barrett's 06:50 Eastern rebuild in
both standard and daylight time. The course index runs weekly rather than daily
because it is the catalog rather than enrollment, and a full build is about 2500
requests against a university API.

Each script refuses to write a file that came back too thin: at least 5000 rated
professors, at least 50 subjects of seats, at least 100 subjects and 1200 courses
per term in the index. All three write to a temp file and rename, so a crash
cannot leave a half-written file.

## Running it locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly off the
filesystem will not work, because `file://` pages cannot make cross-origin
requests.

The pipelines are Node 22 ESM with no dependencies, using global `fetch`:

```bash
node scripts/fetch-ratings.mjs           # the full Ohio State roster

node scripts/fetch-seats.mjs             # term derived from today's date
node scripts/fetch-seats.mjs 1268        # or name one

node scripts/fetch-courses.mjs           # every searchable term, about 2 minutes
node scripts/fetch-courses.mjs 1268      # one term only; the file is rewritten,
                                         # so any term left out is dropped from it
```

Term codes are `1` plus the last two digits of the year plus a term digit, where
2 is Spring, 4 is Summer and 8 is Autumn. Autumn 2026 is `1268`.

## Repo layout

```
index.html            the whole page
css/finder.css        one stylesheet, no framework
js/
  app.js              wiring, state, URL sync
  api.js              client for OSU's class API
  rank.js             merging duplicate course records, ranking, and splitting
                      results into what was asked for and what merely matched
  render.js           list view, grouping sections by instructor
  calendar.js         week grid
  detail.js           right pane
  filters.js          client-side filtering
  ratings.js          RMP snapshot and name matching
  seats.js            Barrett snapshot and the term guard
  courses.js          lazily loaded course index
  format.js           days, times, units, instructor lists
scripts/              the three pipelines
data/                 the three snapshots, committed
docs/                 what was learned about each upstream source
wireframes/           the three layouts considered before the current one
```

Finder is not affiliated with or endorsed by The Ohio State University.

## License

MIT. See [LICENSE](LICENSE).
