# Barrett's schedule

Ohio State's class API returns one `enrollmentTotal` per course and repeats it
onto every section, so it cannot tell a full section from an empty one. Barrett
publishes a plain text schedule that has the real per-section numbers, plus the
enrollment limit that the API never exposes at all.

This document records the format, verified byte by byte against every subject
file for Autumn 2026 on 2026-08-18.

## Where it lives

```
https://www.asc.ohio-state.edu/barrett.3/schedule/                 subject index, HTML
https://www.asc.ohio-state.edu/barrett.3/schedule/{SUBJECT}/{TERM}.txt
https://www.asc.ohio-state.edu/barrett.3/schedule/SUBJECT/term.txt instructions
```

`{SUBJECT}` is case sensitive and uppercase. The index lists 337 of them. A
subject not offered in the term returns 404, which is normal and not an error.
For 1268, 241 of the 337 had a file.

`{TERM}` is a 4-digit code: the first three digits are the calendar year minus
1900, the last is the season, 2 for spring, 4 for summer, 8 for autumn. Autumn
2026 is `(2026 - 1900) * 10 + 8 = 1268`.

There is no robots.txt and no CORS header. A browser cannot fetch this, which is
why `scripts/fetch-seats.mjs` runs in Actions instead.

## Freshness

Every subject file carries the same `Last-Modified` and the same `updated:` date
in its header, so this is one nightly batch, not a live feed. The observed build
time is about 06:50 Eastern. Treat the numbers as a daily figure.

## File shape

Three header lines, then blank-line-separated groups of sections, then up to two
trailer tables that use completely different layouts.

```
CSE         1268 (Autumn 2026)         updated: 18-Aug-2026
<blank>
                       class#    (autoenrolls)                                enrld/limit/+wait
<blank>
     CSE 1110             4817 L                                      ONLINE      26/40       M.Mallon
```

The trailers start with `INDependent study classes` and `waitlist report:`.
Parsing has to stop at whichever comes first, because rows in the independent
study grid can otherwise look like section lines.

## Column map

Half-open `[start, end)`, 0-indexed. Every one of the 17680 section lines in
term 1268 fits this exactly, with nothing left over.

```
 0..8   subject, right aligned
 9..18  catalog number, suffixes like 2011T and 1110.01 included
19..24  campus code, NWK or WST, usually blank
24..31  class number, right aligned, 4 or 5 digits
31..32  component letter: B C F I L R S W
33..48  autoenroll parent(s), "( 4818)" or "(30558,30559)"
48..57  weekday flags, one fixed column each
57..69  time, "0350P" or "1245P-0205", end time carries no meridiem
69..94  room, enrolled/limit, waitlist
94..    instructor, optionally prefixed "{7W1}" and suffixed "(GR)" or "(TA)"
```

Weekday columns:

```
49 M   50 T   51 W   52 R   53 F   54 Sa   55 Su
```

Saturday is an uppercase `S` and Sunday a lowercase `s`.

### Two corrections worth knowing

The class number is at 24..31, not 20..31. Columns 20..22 hold a separate campus
code, so a wider slice swallows `NWK` into the class number.

Weekdays run to column 55, not 53. AVIATN 2101 meets on Saturdays.

### Why 69..94 is matched, not sliced

Room is left aligned from column 70 and enrollment is right aligned with the
slash at column 84, but a long room name pushes them together, and a 4-digit
enrollment eats the space before the waitlist. Both happen in the real data:

```
 CIVILEN 4001             7739 B  ( 7592)         T R     0530P-0735  BO0410/420   79/88       A.Massari
 ANATOMY 2300            35179 L                 M W F    0800A       ONLINE    1045/1050+4   K.Stover, E.Tkacz (TA)
```

So that whole region is matched against
`^\s*(?:(\S+)\s+)?(\d+)/(\d+)(?:\s*\+(\d+))?\s*$` instead, which pins the room,
the counts, and the waitlist without assuming fixed widths.

## Rows that are not sections

Between section lines sit continuation rows carrying an extra meeting time for
the section above. They have a blank class number and the word `and` at column
44:

```
                                            and    W      0715P-0900
```

There were 1080 of them in term 1268. They are counted, not parsed.

## The residue check

After slicing out every known field the parser blanks those columns and asserts
that nothing but whitespace is left. A line that fails goes into a failure count
rather than being dropped quietly, and the job exits non-zero if more than 0.5%
of lines fail. That is what catches a layout change instead of shipping wrong
seat numbers.

Measured on 2026-08-18: 17680 section lines, 0 residue failures.

## What changed overnight

The job fetches both sides of the diff every night and used to keep only one of
them. Comparing the 2026-08-18 snapshot against 2026-08-19 for term 1268: 17680
sections became 17688, 8 added, 2468 changed, 248 went from full to open and 239
from open to full. That is 14% of the term moving in a night.

So each term also gets `data/trend-{term}.json`:

```json
{
  "term": "1268",
  "from": "2026-08-18",
  "days": ["2026-08-19", "2026-08-20"],
  "enrolled": { "4817": [-1, 0] },
  "waitlist": { "4831": [1, 0] },
  "opened": ["1047"]
}
```

Series hold the per-day change in that field, not the count, and line up with
`days` one for one. `from` is the date the first entry was measured against, so
the span either side of any movement is computable even after the window slides.
`opened` is the sections that went from full to open on the last day in `days`,
which is the only day worth marking.

Three rules keep it honest and keep it small:

- Series that are all zero are dropped. Across the two nights on record 3331 of
  the 17692 sections moved at all, and 629 had a waitlist move. That prune is
  what holds the two-day file at 58436 bytes, 14103 gzipped.
- The window is capped at 7 days. A week is as far back as a registration
  decision reaches, and without a cap the file grows all term. Only three
  snapshots exist so far, so a full seven-day file has not been measured and it
  will be bigger than the two-day one above. The cap is `TREND_DAYS` in
  `scripts/fetch-seats.mjs`.
- An append only happens when `sourceUpdated` moves. Barrett freezes a term once
  it is over, and `data/seats-1262.json` has read 2026-04-27 since April, so
  without that gate a dead term stacks a fake flat day every night forever.

`js/trend.js` will not draw anything until a series has moved on three separate
days, so this renders blank until a term has three nights of history.

## Caveats for anything consuming data/seats.json

- Barrett has fewer sections than the API, 484 for CSE against roughly 1000.
  A class number that is absent means unknown, never zero.
- Barrett and the API disagree on some instructors. Class 4827 is KT Vandergriff
  in the API and D.Heym here. The API is the live system of record for names.
  Barrett is used for seats only.
- Enrolled can exceed the limit. Class 4831 is 41/40 with one on the waitlist.
