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
| `q` | Free text. Matches subject, catalog number, course title, and instructor name. Multi-word queries are a union, not an intersection: `CSE 2331` matches anything with `CSE` or `2331` |
| `campus` | `col` for Columbus |
| `term` | A `strm` code, for example `1268` |
| `p` | 1-based page number |
| `sort` | `catalogNumber`, `subject`, or `-` prefixed for descending. Default is relevance, which is the source of the paging trouble below |
| `subject` | Subject code, lowercase. Exact, unlike putting the code in `q`. Combines with `q` as an intersection |

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

**Paged search is not deterministic in its default order.** Pulling the identical
query three times back to back returns a different set of sections each time:

```
run 1: 1001 CSE sections    totalPages=7
run 2: 1010 CSE sections    totalPages=7
run 3: 1001 CSE sections    totalPages=7

intersection of all 3:  947
union of all 3:        1064
missing from run 1:      63
```

Roughly 6% of sections differ per pull, so any single multi-page pull silently
misses some. The cause is the default relevance ordering reshuffling ties, and
`sort=catalogNumber` pins it. Eight identical `q=Smith` pulls, Autumn 2026, a
674 section result over four pages:

| Order | Sections per pull | In every pull | Sections that moved |
|---|---|---|---|
| relevance | 635 to 674 | 565 | 109 |
| `catalogNumber` | 673 or 674 | 672 | 2 |

Sorting does not make paging perfect, it makes it about 98% better. Two sections
still came and went across those eight pulls, so a stable order is an observation
and not a promise. At course level the same eight pulls returned 93 courses
taught by a Smith seven times and 92 once, against 86 to 93 unsorted.

**Future terms appear late.** Querying `term=1272` (Spring 2027) returned zero
results on 2026-08-18 while the term was already visible elsewhere on campus.

## Searching from the client

`js/api.js` serves one student typing one query, so it cannot walk the whole
result the way the catalog build does. It reads at most five pages, and that
budget is what makes the choice of order and parameters matter. Three findings
shape it, all measured on Autumn 2026.

### Five pages is still the right budget

The multi-page fetch exists because relevance does not put a match on page 1.
Sorting did not remove the need for it. Distinct courses found as the pull gets
deeper, counting only courses the query should actually return:

| Query | Pages | Page 1 | 2 | 3 | 4 | 5 | All |
|---|---|---|---|---|---|---|---|
| `Smith`, relevance | 4 | 0 | 0 | 57 | 93 | 93 | 93 |
| `Smith`, `catalogNumber` | 4 | 4 | 14 | 62 | 92 | 92 | 93 |
| `Chen`, relevance | 4 | 0 | 0 | 63 | 87 | 87 | 87 |
| `Lee`, `catalogNumber` | 3 | 79 | 168 | 192 | 192 | 192 | 192 |
| `organic chemistry`, relevance | 6 | 11 | 13 | 13 | 13 | 13 | 13 |
| `CSE`, relevance | 7 | 44 | 65 | 83 | 95 | 102 | 104 |
| `Bucci` | 1 | 9 | 9 | 9 | 9 | 9 | 9 |

`Smith` and `Chen` are the case that #14 was filed for, and they are unchanged:
the first two pages carry none of that professor's courses under relevance, and
the answer is only complete on page 4. Sorting starts finding them earlier but
still needs page 4. Nothing in the data supports cutting the budget below five,
so it stays at five. Common surnames run to four pages and rare ones to one, so
the budget is rarely spent in full.

### Sorting has a price when the result is truncated

A sorted page 1 is the lowest catalog numbers, not the best matches. That is what
you want when you intend to read every page and the opposite of what you want
when you stop early. Distinct courses found in five pages:

| Query | Pages | Relevance | `catalogNumber` | All |
|---|---|---|---|---|
| `MATH` | 11 | 89 | 21 | 89 |
| `creative writing` | 9 | 3 | 3 | 3 |
| `CSE` | 7 | 102 | 101 | 104 |
| `organic chemistry` | 6 | 13 | 13 | 13 |
| `machine learning` | 4 | 5 | 5 | 5 |
| `Smith` | 4 | 86 to 93 | 92 to 93 | 93 |

`MATH` is the worst case and it explains the rule. MATH 1151 alone has 173
sections, so a thousand sections in catalog order never reach the 2000s. So the
client sorts, reads `totalPages` off the first response, and keeps the sorted
order only when the whole result fits in the budget. When it does not fit it
pulls the relevance pages as well and merges, since `mergeCourses` in
`js/rank.js` dedupes by class number and the sorted page it already paid for is
then extra coverage rather than waste.

### `q` is a union, `subject` is a filter

`q` matches on any token, not all of them. `q=CSE 2331` returns 1248 sections
over seven pages spread across nine subjects, because a section matches on `CSE`
or on `2331`. The two parameters do combine, so moving the subject out of `q`
turns the same question into one page:

| Request | Items | Pages |
|---|---|---|
| `q=CSE 2331` | 1248 | 7 |
| `subject=cse&q=2331` | 50 | 1 |

Checked over 18 course lookups, the narrow form returned the identical course
records and the identical set of class numbers as the five page relevance pull,
section for section, nothing missing. All 102 sections of PHYSICS 1250 and all
107 of CHEM 1210 came back either way. What it drops is the thousand sections
nobody asked for.

The catch is telling a subject code from a surname. `CSE` and `Smith` are the
same shape to a regular expression, and `subject=smith` returns zero rather than
an error, so a wrong guess costs a wasted round trip on the commonest search
there is. The client only reads a token as a subject when the query also carries
a catalog number, which a bare surname never does, and it falls back to plain
text if the subject turns out not to be offered. A bare `MATH` is therefore left
as free text on purpose.

Across a 37 query mix this cut requests by 26% and median wall time by 29%.
`CSE 2331` went from five requests and 572 ms to one request and 101 ms.

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
| Sections returned | 1064, stable | 484, stable |
| Instructor names | full, plus email address | initials only, `D.Kline` |
| Sections it has that the other lacks | 657 | 77 |

Both counts are now exact. The API side is a `subject=cse&sort=catalogNumber`
walk, which returned the identical 1064 class numbers on three consecutive full
pulls, so the older "about 1000, varies per pull" caveat no longer applies. See
the paging note above.

Of the 77 sections only Barrett lists, 16 carry a regional campus code and so
cannot appear in a `campus=col` pull at all. The other 61 are Columbus rows the
API genuinely does not return, spot checked by class number.

Coverage is one question and instructor naming is a different one, so they are
measured separately. Restricted to the 407 sections both sources actually list:

| | count |
|---|---|
| Barrett names an instructor where the API is blank | **0** |
| API names an instructor where Barrett is blank | 0 |
| Both name an instructor | 401 |
| Neither names one | 6 |

Two of those 407 have something in Barrett's instructor column where the API has
nobody, but the content is `{7W2}`, a seven week session code rather than a
person, so the count above is 0 and not 2.

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

**Count Barrett sections with the real parser.** The numbers in this section were
originally wrong because they came from a hand rolled fixed column slice at
columns 20 to 30, which swallows the campus code on regional campus rows, so a
line like `CSE 2111  NWK  4816 L` never parsed as a section at all. That dropped
exactly the 16 regional rows and produced the old figure of 468. `parseSubjectFile`
in `scripts/fetch-seats.mjs` carries the column map that #19 verified against
every subject file, and it parses all 484 CSE rows with zero residue. Use it, or
read `data/seats.json`, rather than slicing columns by hand.

## Courtesy

This API is public but undocumented, and it is a university's, not a vendor's.
Finder issues one request per user search from the user's own browser, which is
the same load pattern as using OSU's own site. Bulk pulls should stay
rate-limited and infrequent.
