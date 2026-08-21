# Finder

Find who teaches your classes before everyone else.

**Live: https://enesyilmazcode.github.io/Finder/**

Ohio State's class search will confirm that CSE 2221 exists. It will not
tell you which of its sections still has a seat, or which instructor people
warn you about. Finder answers both. Search a course and you get every
section grouped by instructor, with a rating next to each name and real
seat counts where they exist.

---

## Why this exists

[osucoursesearch.org](https://osucoursesearch.org) did roughly this job and
went down. Its database stopped answering and its author moved on, so the
site now returns a Django error page instead of course data.

Finder has no server and no database behind its search, so there is no
equivalent piece to fail. It is a folder of files on GitHub Pages.

## What you see

```
+-----------------------------------------------------------------------------+
| Finder   [ CSE 2221        ]  [ Autumn 2026 v ]   [ Search ]                |
+---------------+-------------------------------------------+-----------------+
|               | [ List ] [ Calendar ]                     | SECTION 5168    |
| FIND A COURSE |                                           | Paolo Bucci     |
|  Subject      | 1 course, 22 sections in Autumn 2026.     | CSE 2221        |
|  Number       | Seats as of Aug 19.                       | Lecture, 4 cr   |
|               |                                           |                 |
| MEETS ON      | CSE 2221  Software I: Software Components | 3.0  from 147   |
| Mo Tu We Th Fr| 4 credits, 22 sections                    | 4.1  difficulty |
|               |                                           | 40%  take again |
| TIME OF DAY   |   Can Alpay  2.7 (3)                      |                 |
|  Starts after |     5477  TuTh 4:10p   DL 357   40/40 +1  | SEATS           |
|  Ends before  |     5478  WeFr 4:10p   DL 280   40/40 +1  | [========  ]    |
|               |   ...                                     | Enrolled 32/40  |
| BUSY TIMES    |   Paolo Bucci  3.0 (147)                  | Waitlist none   |
|  TuTh 9:35a x |     5168  TuTh 8:00a   DL 357   32/40     | As of  Aug 19   |
|               |     5169  WeFr 8:00a   DL 280   32/40     |                 |
| INSTRUCTOR    |   ...                                     | MEETS           |
|  Min rating   |   Naomi Lynn Zweben  4.9 (44)             | TuTh 8:00a      |
|  Only rated   |     4831  TuTh 11:30a  DL 357   41/40 +2  | Dreese Lab 357  |
|               |     4833  TuTh 12:40p  DL 357   40/40 +1  |                 |
| AVAILABILITY  |                                           | ALSO TEACHES    |
|  Hide full    | > Show 6 related courses                  | ABOUT           |
|  Hide online  |                                           |                 |
+---------------+-------------------------------------------+-----------------+
```

On a phone the filters move behind a Filters button and the right pane
takes over the screen, so you get the same three panes one at a time.

- **Filters.** Days, time window, busy times, minimum rating, hide full, hide online.
- **Middle.** The same sections as a list by instructor, or on a week grid.
- **Right pane.** Rating, difficulty, take-again, seats, room, description.

No filter touches the network, and nothing a filter hides vanishes quietly:
the page says how many sections it removed and offers a button that shows
them anyway. There is no saved schedule and no conflict detection. Finder
searches, it does not plan.

## Where the data comes from

```
EARLIER TODAY   These two sites refuse to answer a web page, so a computer
                on GitHub asks them for you every morning and saves each
                answer as a file in this repo:

   ratemyprofessors.com  ->  data/ratings.json       every rated OSU professor
   asc.ohio-state.edu    ->  data/seats-1268.json    Autumn 2026 seat counts

                a third file, data/courses.json, is
                rebuilt the same way once a week
                              |
                              v
                   committed to the repo, then served
                   like any other file on the site

RIGHT NOW       You type CSE 2221 and press Enter, and your browser asks
                Ohio State itself:

   content.osu.edu/v2    ->  every section, seconds old
                              |
                              v
                     the page in front of you
```

Only the saved files can go stale, which is why the page prints the date
the seat counts came from.

The split is not a preference. A website can refuse to be read by a page
from another website, and RateMyProfessors and Barrett's schedule both do.
The Ohio State address in that picture does not. It sends one header,
`Access-Control-Allow-Origin: *`, which is standing permission for any page
to read it. That header is why Finder can exist with no server.

### OSU's API reports enrollment wrong per section

OSU's class API returns one enrollment number per course and stamps it onto
every section. It publishes no per-section enrollment cap at all. For
CSE 2221 in Autumn 2026 it calls all 22 sections open. 12 of them are full.
Class 4831 is 41 people in a 40-seat room with two waiting, still listed
open.

Seats come from Barrett's schedule instead, a fixed-width text file that
`asc.ohio-state.edu` rebuilds once a day around 06:50 Eastern. Barrett
lists fewer sections than the API, 407 of Autumn 2026's 1,064 CSE sections
when I checked on August 20, so some rows show no seat numbers. That beats
printing a zero nobody checked.

### Most instructors are not on RateMyProfessors

About 36% are, measured across 757 instructors in 8 subjects for Autumn
2026. Unrated is the ordinary case, so it costs nothing on screen. Every
name is a link either way, to a profile when there is a match and to a
RateMyProfessors search when there is not. Matching drops middle names and
suffixes, so OSU's "Diana Ikenberry Kline" finds RateMyProfessors' "Diana
Kline". When two professors share a first and last name the lookup returns
nothing rather than picking one, because a wrong rating is worse than no
rating.

## What one search does

```
you type "CSE 2221" and press Enter
        |
        +--> content.osu.edu/v2       the 22 sections, live
        +--> data/ratings.json        Paolo Bucci, 3.0 from 147 ratings
        +--> data/seats-1268.json     class 5168 has 32 of 40 seats
        |
        |    the two files start downloading when the page opens,
        |    so a search usually waits on Ohio State alone
        v
   rank.js      merge the pages, score every course against your words
        v
   render.js    group the sections by instructor, rating beside the name
        v
   the page you are looking at
        |
        +--> change a filter --> filters.js redraws from memory, no network
```

Only the newest search is allowed to draw, so a slow first search can never
paint over a fast second one.

## Run it locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` off the filesystem
fails, because `file://` pages cannot make cross-origin requests.

The snapshot scripts are Node 22:

```bash
node scripts/fetch-seats.mjs 1268
```

`npm test` runs 138 tests through `node --test`, with nothing installed.

## Repo layout

```
index.html            the whole page
css/finder.css        the app stylesheet, no framework
js/
  app.js              wiring, state, URL sync
  api.js              client for OSU's class API
  rank.js             merging, scoring, splitting results
  render.js           list view, grouped by instructor
  calendar.js         week grid
  detail.js           right pane
  filters.js          client-side filtering
  ratings.js          RMP snapshot and name matching
  seats.js            Barrett snapshot and the term guard
  courses.js          lazily loaded course index
  format.js           days, times, units, names
  hit.js              one page-view ping, skipped on localhost
scripts/              the three snapshot jobs
data/                 the snapshots, committed
docs/                 what OSU's API and Barrett's schedule get wrong
tests/                138 tests, zero dependencies
wireframes/           three layouts considered first
analytics/            the page-view counter, a Cloudflare Worker
stats/                the page that reads the counter
```

## Limits

- Seats are a morning snapshot, so a section can fill before you search.
- Barrett covers fewer sections than the API, so some rows never show seats.
- The Back button does nothing, and a shared calendar link opens as a list.
- Changing a filter clears whichever section you had selected.
- Columbus only, and only the three terms OSU's API exposes at a time.
- A section with several meeting patterns shows the first one.

Finder is not affiliated with or endorsed by The Ohio State University.

## License

MIT. See [LICENSE](LICENSE).
