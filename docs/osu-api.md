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
| `sort` | `catalogNumber`, `subject`, or `-` prefixed for descending. Default is relevance, which is the source of the paging trouble below |
| `subject` | Subject code, lowercase. Exact, unlike putting the code in `q` |

Neither `sort` nor `subject` needs guessing. Every response carries `sort` and
`filters` arrays, and each entry in them spells out the parameter and value that
applies it. The other facets listed there work the same way. See Enumerating the
catalog.

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
misses some. This is the default relevance ordering shuffling ties, and
`sort=catalogNumber` pins it, which is measured under Enumerating the catalog
below. Without that, the practical rule is **keep queries narrow enough to fit on
one page.**
A user searching `CSE 2221` is unaffected because the result fits on page 1. A
feature that tries to enumerate an entire subject would be quietly lossy, and
should not be built on this endpoint without reconciling several pulls.

**Future terms appear late.** Querying `term=1272` (Spring 2027) returned zero
results on 2026-08-18 while the term was already visible elsewhere on campus.

## Enumerating the catalog

Everything above describes searching. Building the subject and number pickers
needs the opposite, a complete list of what exists, and that is a different
problem. `scripts/fetch-courses.mjs` solves it and writes `data/courses.json`.

### Search takes a subject filter

Every response carries a `filters` array, and each item in it has a `term` value
that is itself a query parameter. That is where `subject` comes from:

```
?q=&campus=col&term=1268&subject=cse
```

The code goes in lowercase. `subject=CSE` returns zero. This is much better than
putting the code in `q`, because `q=CSE` also matches titles and instructor
names: for Autumn 2026 it returned 1236 sections spread over nine subjects,
while `subject=cse` returned exactly the 1064 that are actually CSE. Those 1064
match the union of three pulls recorded in the paging note above, so the subject
filter's `totalItems` is the honest count of a subject.

The same trick gives `catalog-number` (buckets `1xxx` through `8xxx`),
`academic-career`, `academic-program`, `component`, `class-session`,
`instruction-mode` and `evening`.

Two things worth knowing about the shape. `totalItems` counts sections, not
courses, so a page of 200 sections collapses into anywhere from 20 to 110
`courses` entries. And the course object carries `subjectDesc`, the subject's
full name, which is what the picker shows next to the code. It is blank for 15
subjects including CYBRSEC, TLED, MMT and NRO, and the subject facet's title is
the same string, so there is no second source to fall back to.

### There is no subject endpoint

`/classes/subjects`, `/classes/subject`, `/classes/searchableSubjects` and
`/classes/filters` all return 404. The `subject` facet is capped at ten entries,
so it does not enumerate either: an empty query for Autumn 2026 lists ten
subjects out of the 243 that exist.

Barrett's index is the only ready made list, and it is incomplete. It names 337
codes, but 18 subjects that Autumn 2026 actually offers are missing from it:

```
AMINSTS ASAMSTS CIVICLL CIVICTL COMPEDU CYBRSEC ETHNSTD MMT NRO
RADONC TLCTE TLED TLIELP TLISTEM TLLLL TLTED UKRAIN UROLOGY
```

Sweeping the API instead, one pass over the eight `catalog-number` buckets, found
238 subjects but missed five that Barrett has and the API does offer (EDUTL, HW,
RADIOLG, SWAHILI, URDU). That sweep was in relevance order, so it was lossy for
the reason below. So the script uses all three: Barrett as a seed, a sweep
per term, and the subject codes already in the last `courses.json`. A candidate
that is not offered costs one request and is dropped.

### Sorting fixes the paging

The non-determinism has a cause and a cure. It is a paging artifact, and the
default sort is relevance, which shuffles ties between pulls. A course drifts
across a page boundary and the walk misses it. Pass `sort=catalogNumber` and the
pages stop moving. Eight identical pulls of each subject, Autumn 2026:

| Subject | Pages | Courses, relevance order | Courses, catalog order | Union |
|---|---|---|---|---|
| PSYCH | 1 | 79 every time | 79 every time | 79 |
| MATH | 3 | 89 every time | 89 every time | 89 |
| CHEM | 4 | 57 to 58 | 58 every time | 58 |
| ECE | 7 | 72 to 73 | 73 every time | 73 |
| CSE | 6 | 102 to 104 | 104 every time | 104 |
| HISTORY | 4 | 107 to 111 | 111 every time | 111 |
| HTHRHSC | 3 | 61 to 65 | 65 every time | 65 |

Sorted, all 36 multi-page subjects returned the identical set four times running.
Subjects that fit on one page never varied either way, and there are 207 of those,
so relevance order only ever hurt the other 36.

Sorting does not change what comes back, only the order it comes back in. The
sorted result equals the union of many unsorted pulls in every case measured.

### Reconciliation, and how much it recovers

Reconciling repeated passes is still worth doing, because a stable order is an
observation and not a promise. It is just no longer load bearing. Three whole-term
builds in relevance order, against a reconciled index of 6072 courses for Autumn
2026:

```
single pass 1: 6068 courses, 4 missing   CHEM 6440, HISTORY 2350, 3002, 3351
single pass 2: 6069 courses, 3 missing   CSE 6521, CSE 6891, ECE 3551
single pass 3: 6064 courses, 8 missing   CHEM 6330, 6540, 6780, HISTORY 2025, ...
```

Not one of the three found a course the reconciled set lacked, so the union only
grows toward the truth. At course level the loss is 0.05% to 0.13%, far below the
roughly 6% seen at section level, because a course disappears only when a pull
drops every one of its sections. That is why it lands on graduate courses with a
single section, and why CSE 6521 vanishing is not something anyone would notice.

One clean pass is too weak a stopping rule on its own. Unsorted, CHEM plateaued
for a pass and then found more on the next, and a build that stopped there came
out two courses short. The script sorts, then stops after two consecutive passes
that add nothing, capped at eight, and says so if a subject is still growing at
the cap. Sorted, the first pass has found everything every time: three
consecutive full builds hashed identically and the reconciliation passes added
nothing to any of them.

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
