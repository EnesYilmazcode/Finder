# The OSU class API

Ohio State runs a public JSON API that serves course, section, instructor, and
enrollment data. It is undocumented publicly, requires no authentication, and is
what powers [classes.osu.edu](https://classes.osu.edu). Everything Finder shows
comes from it.

This document exists so the project never has to rediscover it.

## How it was found

`classes.osu.edu` is an AngularJS shell. The page HTML is 3.5 KB and contains no
API references. The endpoints are in the bundle it loads, `osu-mobile.js`, which
names a base of `https://content.osu.edu/v2` and three paths under `/classes`.

## Base

```
https://content.osu.edu/v2
```

No API key, no login, no session cookie. Responses include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS, HEAD
```

That header is the reason Finder needs no backend. A browser can call this API
directly from any origin, including a GitHub Pages site.

## Endpoints

### GET /classes/searchableTermsV2

Returns the terms currently open to search. Use it to populate a term selector
rather than hardcoding, because the set changes as terms roll over.

```json
{"data":{"data":[
  {"strm":"1268","descr":"Autumn 2026","classSearch":"Y",
   "startDate":"2026-02-09","endDate":"2027-01-31"}
]}}
```

Measured on 2026-08-18, this returned exactly three terms: Spring 2026 (`1262`),
Summer 2026 (`1264`), and Autumn 2026 (`1268`).

### GET /classes/search

The main endpoint.

| Parameter | Notes |
|---|---|
| `q` | Free text. Matches subject, catalog number, course title, and instructor name |
| `campus` | `col` for Columbus |
| `term` | A `strm` code, for example `1268` |
| `p` | 1-based page number |

`q` matching instructor names is worth calling out, because it means searching by
professor needs no separate index. Verified: `q=Bucci` returns 17 results, all of
them Paolo Bucci's sections, and `q=Kline` correctly returns two different Klines
in two different departments.

Results come back as courses with sections nested inside:

```
data
├── totalItems, totalPages, currentItemCount, nextPageLink
└── courses[]
    ├── course     title, description, subject, catalogNumber, minUnits, maxUnits
    └── sections[]
        ├── classNumber, section, component, instructionMode
        ├── enrollmentStatus, enrollmentTotal, waitlistTotal
        └── meetings[]
            ├── startTime, endTime, monday..sunday
            ├── facilityDescription, facilityCapacity
            └── instructors[]  displayName, role, email
```

Note that instructors hang off `meetings`, not off the section, so a section's
instructor list is the union across its meetings and can contain duplicates.

A real section:

```json
{
  "classNumber": "5168", "section": "0005", "component": "Lecture",
  "enrollmentStatus": "Open", "enrollmentTotal": 32, "waitlistTotal": 0,
  "meetings": [{
    "startTime": "8:00 am", "endTime": "8:55 am",
    "tuesday": true, "thursday": true,
    "facilityDescription": "Dreese Laboratories", "facilityCapacity": 46,
    "instructors": [
      {"displayName": "Paolo Bucci", "role": "PI", "email": "bucci.2@osu.edu"}
    ]
  }]
}
```

### GET /classes/availability

Retired, as far as can be determined. Every parameter shape tried returned
`503 Service Unavailable`, and a path-style variant returned `404`. It is still
referenced in `osu-mobile.js`, so the reference is stale rather than a hint.

## Term codes

The `strm` code is `1` + the last two digits of the year + a term digit, where
`2` is Spring, `4` is Summer, and `8` is Autumn.

```
1268  ->  1 | 26 | 8  ->  Autumn 2026
1272  ->  1 | 27 | 2  ->  Spring 2027
```

Do not compute these locally. Read them from `searchableTermsV2`, since a code
being well formed does not mean the API has data for it.

## Limits worth knowing

**Broad queries cap at 10,000 results.** An empty `q` for Autumn 2026 reports
`totalItems: 10000` across exactly 50 pages of 200, which is a ceiling rather
than a count. A full catalog pull has to iterate by subject.

**There is no enrollment cap field.** Sections carry `enrollmentTotal`,
`waitlistTotal`, `waitlistCapacity`, and `minimumEnrollment`, but nothing giving
the section's own limit. `facilityCapacity` is the room's capacity and is not the
same number. So Finder shows enrolled counts and `enrollmentStatus`, and does not
draw a percent-full meter it cannot honestly compute.

**Paged search is not deterministic.** Pulling the identical query three times
back to back returns a different set of sections each time:

```
run 1: 1001 CSE sections    totalPages=7
run 2: 1010 CSE sections    totalPages=7
run 3: 1001 CSE sections    totalPages=7

intersection of all 3:  947
union of all 3:        1064
missing from run 1:      63
```

Roughly 6% of sections differ per pull, so any single multi-page pull silently
misses some. The practical rule: **keep queries narrow enough to fit on one page.**
A user searching `CSE 2221` is unaffected because the result fits on page 1. A
feature that tries to enumerate an entire subject would be quietly lossy, and
should not be built on this endpoint without reconciling several pulls.

**Future terms appear late.** Querying `term=1272` (Spring 2027) returned zero
results on 2026-08-18 while the term was already visible elsewhere on campus.

## Approaches that were considered and rejected

### PeopleSoft scraping

`courses.erppub.osu.edu` hosts the underlying PeopleSoft class search. It serves
Oracle's `ICAction` form-post interface, so extracting data means driving session
cookies and hidden state fields, in practice with a headless browser. The previous
generation of this tool did exactly that, with a Selenium grid as a hard runtime
dependency. There is no JSON endpoint. Avoid.

### Barrett's schedule

`asc.ohio-state.edu/barrett.3/schedule/{SUBJECT}/{TERM}.txt` publishes
fixed-width plaintext schedules per subject and term, including instructors, and
was the previous tool's source for instructors it could not otherwise see.

It is still live and it does two things this API does not: it carries each
section's enrollment **limit**, and it posts future-term drafts earlier. But it is
strictly worse as a primary source. Compared head to head for CSE, Autumn 2026:

| | OSU API | Barrett |
|---|---|---|
| Sections returned | about 1000, varies per pull | 468, stable |
| Instructor names | full, plus email address | initials only, `D.Kline` |
| Sections it has that the other lacks | about 580 | about 80 |

The API counts are deliberately approximate. Paged search is non-deterministic,
so repeated identical pulls disagree by a few percent. See the paging note above.
Barrett is a static file and its count is exact.

Coverage is one question and instructor naming is a different one, so they are
measured separately. Restricted to the 388 sections both sources actually list:

| | count |
|---|---|
| Barrett names an instructor where the API is blank | **0** |
| API names an instructor where Barrett is blank | 0 |

That first row is the decisive one. On shared sections the two sources agree
completely, so Barrett does not surface a single instructor the API is missing.
That removes the entire reason the old tool depended on it. The API's real
advantage is coverage, roughly twice as many sections, not better naming.

Freshness also favors the API. Every one of Barrett's 337 subject files carries an
identical `Last-Modified`, and across terms the timestamps land at 10:50 GMT in
summer and 11:50 GMT in winter, so it is a single daily batch at 06:50 Eastern.
The API is the live system of record.

Barrett may still be worth revisiting for enrollment limits. It is not worth
depending on for instructors.

## Courtesy

This API is public but undocumented, and it is a university's, not a vendor's.
Finder issues one request per user search from the user's own browser, which is
the same load pattern as using OSU's own site. Bulk pulls should stay
rate-limited and infrequent.
