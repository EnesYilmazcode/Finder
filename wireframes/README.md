# Layout wireframes

**Outcome: A won, and shipped in [#30](https://github.com/EnesYilmazcode/Finder/pull/30).**
These are kept as a record of the decision, not as a description of the app. The
live site is https://enesyilmazcode.github.io/Finder/

## The problem they were answering

Before [#30](https://github.com/EnesYilmazcode/Finder/pull/30), Finder was a
single centred column that left the left and right thirds of a desktop screen
empty. Three answers were drawn rather than one, so the choice was between real
alternatives instead of variations on a first idea.

- [A. Three pane](a-three-pane.html) — filters, results, section detail
- [B. Compare board](b-compare.html) — one row per instructor, every metric a column
- [C. Schedule grid](c-schedule.html) — sections plotted on a week

## What was taken from each

**A shipped as the layout.** Filter rail, results, and a detail pane, in
[#30](https://github.com/EnesYilmazcode/Finder/pull/30),
[#31](https://github.com/EnesYilmazcode/Finder/pull/31) and
[#32](https://github.com/EnesYilmazcode/Finder/pull/32). The subject and number
pickers it sketched became [#36](https://github.com/EnesYilmazcode/Finder/pull/36).

**C shipped as a view toggle**, not a layout, in
[#33](https://github.com/EnesYilmazcode/Finder/pull/33). Its "my schedule" rail
and "add to my schedule" button were cut: Finder searches, it does not plan, and
a saved schedule means state, which means accounts.

C also raised the design problem worth remembering. Several instructors teach the
same course at the same hour, and CSE 2321 has three sections at MoWeFr 3:00p.
Slicing a slot three ways is unreadable, so a shared slot renders as one block
naming everyone who teaches it.

**B was not built.** Its comparison is what a single-course result already does,
once [#17](https://github.com/EnesYilmazcode/Finder/pull/17) stopped burying it
in unrelated courses. It is a mode rather than a layout.

## Note

These are static mockups with sample data from CSE 2331, Autumn 2026. Nothing
here is wired to the live API, and the styling is deliberately separate from
`css/finder.css` so the app was never constrained by a sketch.
