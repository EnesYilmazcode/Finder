# Historical grade distributions

Ohio State delivered 25 Excel workbooks on **November 4, 2026**, in response
to public records request **27-0272**, submitted August 23. The release covers
**Spring 2018 through Spring 2026** (25 terms). SEI evaluation data remains
pending and is not represented by the grade charts or RateMyProfessors ratings.

## Coverage

The original workbooks contain 121,196 instructor/class rows across six campuses.
Finder searches Columbus, so the published archive retains 103,398 Columbus
instructor/class rows: **92,242 distinct classes and 8,419 normalized instructor
names**, across 231 subjects. A name is not a verified unique person.

The records office explicitly stated:

- Classes with fewer than 10 enrolled students do not appear.
- Classes with student instructors do not appear.
- Classes with multiple instructors appear once per instructor.

These are omissions of whole rows, not blanked grade cells. The number of
omitted classes is unknown. A missing match cannot establish that someone
never taught a course. Blank grade cells in the delivered rows mean zero;
every row's complete set of grade counts reconciles exactly to its `Total`.

## What students see

Opening a section shows historical outcomes for that instructor and exact
subject/catalog number. The card offers all terms combined or an individual
term, a chart of all eleven letter grades, mean grade points, A/A- share,
enrollment and class counts, a withdrawal rate, a complete outcome table and
a term comparison table. The card labels its actual date range and Columbus
scope. An unavailable download displays a retry message; an unmatched record
displays a coverage explanation.

The GPA is the mean of recorded letter-grade points, weighted by grade count.
It is not an official student GPA or an average of class averages. Values are
A=4, A-=3.7, B+=3.3, B=3, B-=2.7, C+=2.3, C=2, C-=1.7, D+=1.3, D=1, E=0.
EN (non-attendance) is included in E and the denominator, as required by
[faculty rule 3335-8-21(I)](https://trustees.osu.edu/bylaws-and-rules/3335-8).
The raw EN count is retained and disclosed separately without counting it twice.

W, S, U, PA, NP, PE, P, I, IX, NEN, UEN, NG and No Grade stay outside the
mean. All published marks are retained. P means progress, not pass. I/IX are
incomplete/extended incomplete; PA/NP are pass/non-pass; PE is emergency pass;
S/U are satisfactory/unsatisfactory. No Grade and NG indicate no recorded grade.
The exact outcome table uses all recorded enrollments as its percentage
denominator; the chart and A/A- share use letter grades only. A course with
no letter grades still shows its other recorded outcomes.

Historical cohorts differ. Honors classes, summer enrollment and pandemic-era
grading policies can change outcomes even with the same instructor. These
records describe past classes and cannot predict a student's grade.

## Instructor matching and team teaching

The actual release contains **names, without instructor emails**. Earlier
scaffolding assumed an email join, but that is unavailable in this delivery.
The importer converts `Last,First Middle` to natural name order and keys on
the complete normalized name, preserving middle names and compound surnames.
Different middle names are not merged into one record.

The browser tries an email identifier when a future source supplies one,
then a full normalized name, then a first/last match only if the global
instructor index has exactly one candidate. There is no fuzzy or nickname
matching. Ambiguity is checked globally, not just within one subject. Identical
full names cannot be distinguished without identifiers; spelling changes can
split one person's record. A unique abbreviated match is still a name match,
not an authenticated identity.

For each term/campus/class number, counts are checked for consistency across
instructor rows. Repeated copies of the same instructor/class are deduplicated;
conflicting copies abort import. Team-taught classes count once for each listed
instructor, and the card discloses how many included classes were shared.
There are 7,154 distinct team-taught Columbus classes. Do not sum instructor
enrollment totals to estimate unique student enrollments across the university.
Current sections with multiple instructors retain Finder's existing behavior
of not presenting a combined instructor curve.

## Rebuild and provenance

Save the original email attachments in `.local/grade-records/`, then run:

```bash
python scripts/import-grade-records.py .local/grade-records
npm test
```

The importer uses Python 3's standard library to read XLSX XML directly, so
there is no lossy manual CSV conversion or added runtime dependency. It handles
shared strings, inline strings and sparse cells. The 25 original workbooks
remain locally preserved and ignored by Git. No email bodies, attachment URLs
or correspondence are included in the public dataset.

Before publishing, it validates headers, identifiers, nonnegative integer
counts, the release's minimum class size, every row's enrollment reconciliation,
and duplicate/co-instructor consistency. All parsing completes before writing.
Under 200 instructor names is refused as an incomplete import. Outputs are
deterministic and each file is replaced atomically. Commit and deploy the
result as one version so the index and subject files stay together.

- `data/grades.json`: release metadata, global instructor identity index and
  subject paths. The full history archive is not downloaded on page load.
- `data/grades/<SUBJECT>.json`: instructor/course aggregates plus per-term
  history. Only the opened section's subject is fetched; requests are shared,
  cached, and retryable after failure.
- `data/grades-provenance.json`: original filenames, SHA-256 hashes, per-file
  row counts, campus counts, term coverage and reconciliation results.

The earlier `scripts/fetch-grades.mjs` CSV importer remains for its documented
legacy format and fixtures. Use the XLSX importer for this release: its blank
cell semantics and additional marks differ from the hypothetical CSV format.

## Data shape

Subject files map instructor keys to exact course codes, such as `CSE 2221`.
Each course has `counts` in the manifest's explicit eleven-mark `scale`, `other`
outcomes, `sections`, `enrolled`, `coTaught`, `terms`, and `history` keyed by OSU
term code. History rows carry the same counts and outcomes for a single term.
EN appears in both the E count and `other.EN` for disclosure; only the E count
is included when reconciling letter grades plus other outcomes to enrollment.
`suppressed: 0` is retained for compatibility; it does not mean no classes were
omitted, because those classes were not delivered and cannot be counted.
