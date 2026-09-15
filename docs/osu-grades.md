# The grade distribution records

Ohio State publishes course grade distributions nowhere. There is no API for
them, no page on the registrar's site, and nothing in `content.osu.edu/v2`.
The file behind `js/grades.js` came from a public records request instead, and
this is what it covers, what it cannot answer, and what has to be true of the
next one.

## The request

Filed under the Ohio Public Records Act, R.C. 149.43, which makes records of a
public university available to any person. Grade distributions aggregated to a
section carry no student identifiers, so they are ordinary public records; the
request nevertheless conceded the small-enrolment suppression below, because
it costs a handful of sections and it is the difference between a fulfilled
request and an argument.

Asked for, per section, for Autumn 2021 through Spring 2026:

| Field | Why |
| --- | --- |
| Term, and the term code | Orders the five years, and `1218` style codes sort without parsing |
| Subject and catalog number | The course key the site already searches on |
| Class number and section number | Two different fields at OSU. `classNumber` 5168 is what BuckeyeLink wants; `section` 0010 is the number within the course |
| Campus | Columbus only is what the site searches; regional sections would otherwise land on a Columbus professor |
| Primary instructor name **and OSU email** | The email is the join. See below |
| Counts per letter grade | A through E, plus S, U, PA, NP, W and I |
| Total enrolled | Lets a row be checked against the counts that are supposed to sum to it |

## The email is the whole point

Every other join in Finder guesses. `js/ratings.js` matches RateMyProfessors on
a first and last name, drops middle names and suffixes, and returns nothing
when two people share a name, because a wrong rating is worse than no rating.
That costs real coverage: both Alan Reeds get nothing.

`content.osu.edu/v2` already publishes an instructor's address beside every
section — `{"displayName": "Paolo Bucci", "email": "bucci.2@osu.edu"}` — and
the records request asked for the same field. So a grade curve is keyed on
`bucci.2` and joins exactly, to one person or to nobody.

Name matching survives as a fallback for rows that came back without an
address, and it inherits the same refusal: two people under one name return
nothing.

## What the file cannot tell you

**A curve is a cohort.** The largest thing moving a distribution is usually who
enrolled, not who taught. Honours sections, majors-only sections, summer
sections and 8am sections are different populations taking the same course
number from the same person. Nothing in these records separates them, so a
curve is evidence about a class, not a measurement of a professor.

**Small sections are missing.** Ohio State withholds distributions for sections
small enough that one student's grade could be inferred. The request asked for
those rows to be retained and flagged rather than dropped, so the snapshot
carries a `suppressed` count per course and the pane can say how many sections
are not in the curve. Where every section of a course was withheld, the record
exists and the curve does not, which `gradesStatus` reports as `withheld` —
distinct from a professor with no record at all.

**Withdrawals are not in the mean.** They cannot be: a W carries no grade
points. That makes the mean of a course a third of the class drops flattering,
so the withdrawal count and its share sit beside the curve rather than inside
it.

**Pass-fail courses have no curve.** S, U, PA and NP carry no points either. A
course graded entirely on them reports `ungraded` rather than an empty
distribution, which would read as a course nobody passed.

**It stops where the live data starts.** Grades exist for terms that are over.
The terms the site searches are the ones OSU's API exposes, which are current
and future. The two never overlap, by construction.

**Team-taught sections are attributed to one person.** The request asked for
the primary instructor, so a section with co-instructors puts its whole
distribution under the PI. Finder draws no curve for a section listing more
than one instructor, for the reason it draws no rating: an average across two
people is not either person's.

## The import

`scripts/fetch-grades.mjs` reads the spreadsheet off disk. It fetches nothing
— the records office sends a file once:

```bash
node scripts/fetch-grades.mjs records.csv
```

Save an XLSX as CSV first. The script reads one sheet of flat rows and nothing
about that needs a spreadsheet parser.

**The column names are not known in advance.** They are whatever the
registrar's export tool produced. Every field is resolved through the alias
tables at the top of the script, and an unresolved one aborts the run printing
the headers the file actually had:

```
Refusing to write data/grades.json.
grades: could not find grade B-, instructor email or name.
The file's headers are: Term | Subject | Catalog | Instructor | A | A- | B+ | B | ...
Add the spelling to HEADERS or GRADE_ALIASES in scripts/fetch-grades.mjs.
```

Adding the spelling is the entire adaptation step. It refuses rather than
guesses because the failure it is avoiding is silent: a file whose `B-` column
went unrecognised would write a curve missing every B-minus in five years and
look completely normal doing it.

One normalising rule is worth knowing about. Field names have their
punctuation stripped, so `catalog_nbr`, `Catalog Nbr` and `CATALOGNBR` are one
spelling. Grade columns do **not**: `A-` would normalise to `a`, which is also
what `A` normalises to, and both columns would resolve to whichever came
first. Every A-minus in the file would be read out of the A column. Grade
headers keep their sign, which is why `markSlug` exists next to `slug`.

### What it refuses to write

The same gate as the other three snapshotters, from `scripts/guards.mjs`:

- Under 200 instructors, which is a file the parser did not understand rather
  than a small year. Not forceable.
- More than 10% below the committed count, which is a partial parse. Forceable
  with `FORCE_WRITE=1`, because a corrected smaller dataset is a real thing to
  ship.
- More than 10% of rows unreadable. Rows from another campus and rows taught by
  "Staff" are skipped rather than failed, and do not count toward this.

`Staff`, `TBA`, `TBD` and `Unassigned` are dropped outright. Folding five years
of unstaffed sections into one key would invent the most prolific instructor
at the university.

## The shape it writes

```json
{
  "source": "The Ohio State University, public records request under R.C. 149.43",
  "campus": "columbus",
  "firstTerm": "1218",
  "lastTerm": "1262",
  "termCount": 15,
  "scale": ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "E"],
  "count": 4211,
  "instructors": {
    "bucci.2": {
      "name": "Paolo Bucci",
      "terms": 9,
      "courses": {
        "CSE 2221": {
          "counts": [180, 120, 95, 140, 60, 45, 70, 25, 15, 20, 90],
          "other": { "W": 61, "I": 4 },
          "sections": 22,
          "terms": 9,
          "suppressed": 2
        }
      }
    }
  }
}
```

`counts` is positional against `scale`, which the file states rather than
assumes, so a reader never has to know the order from somewhere else.
`suppressed` is sections withheld, not students.

Written compact rather than indented, like `data/ratings-courses.json` and for
the same reason: only the detail pane reads it, so indenting it costs every
visitor who opens a section.

## Until it arrives

There is no `data/grades.json` in the repo. `loadGrades` treats a 404 as "not
published yet" rather than as a failure — settled, never retried, and distinct
from the 500 that stays retryable — so the block does not render and nothing
else on the page changes. Everything above is written and tested against
fixtures in `tests/fixtures.js`.
