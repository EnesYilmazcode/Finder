// The right pane. Nothing here fetches. The course codes it reads are the one
// thing not already in memory when a section is selected, and app.js redraws
// the body once they land.

import { formatWhen, formatUnits, instructorsOf, distinctMeetings, attributesOf, attributeLabel, sectionFlags, trendLabel } from "./format.js";
import { ratingFor, searchUrl, profileUrl, ratingSpread, courseShare } from "./ratings.js";
import { faceFor, initials } from "./headshots.js";
import { linkedTo, seatsFor, seatsUpdated, unreachable } from "./seats.js";
import { trendFor } from "./trend.js";
import { SCALE, gradesFor, gradesStatus, gradeSpread, aShare, gradesRange, withheldFor, gradeRecord, gradeHistory, gradeCurveForTerm, gradeTermLabel, gradesRelease, gradeLoadState } from "./grades.js";
import { isIndividualStudy } from "./rank.js";
import { icon } from "./icons.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function block(title) {
  const section = el("section", "d-block");
  section.append(el("p", "eyebrow", title));
  return section;
}

function row(label, value, valueClass) {
  const line = el("div", "d-row");
  line.append(el("span", null, label));
  line.append(el("span", valueClass ? `d-val ${valueClass}` : "d-val", value));
  return line;
}

/** A large figure with its label. Absent data renders as absent, not as zero. */
function figure(value, label, tone) {
  const wrap = el("div", "d-fig");
  const number = el("div", tone ? `d-num ${tone}` : "d-num", value ?? "—");
  if (value == null) number.classList.add("is-none");
  wrap.append(number, el("div", "d-cap", label));
  return wrap;
}

/**
 * Class number, compact copy action, and an optional saved-schedule action.
 */
function sectionHead(section, course, shareUrl, scheduled, onSchedule) {
  const head = el("div", "d-head");
  head.append(el("p", "eyebrow", `Section ${section.classNumber}`));

  // navigator.clipboard is undefined on plain http, so the button is only
  // drawn where it can do something.
  if (navigator.clipboard) {
    const label = "Copy class number";
    const copy = el("button", "d-act", label);
    copy.replaceChildren(icon("copy", 15));
    copy.setAttribute("aria-label", label);
    copy.title = label;
    copy.type = "button";
    // The label is the only feedback there is, so it has to be spoken too.
    copy.setAttribute("aria-live", "polite");
    let timer = 0;
    copy.addEventListener("click", async () => {
      const done = await navigator.clipboard.writeText(String(section.classNumber)).then(() => true, () => false);
      copy.replaceChildren(icon(done ? "check" : "close", 15));
      copy.setAttribute("aria-label", done ? "Class number copied" : "Copy failed");
      // Restart the flash rather than let the last click's timer cut it short.
      clearTimeout(timer);
      timer = setTimeout(() => { copy.replaceChildren(icon("copy", 15)); copy.setAttribute("aria-label", label); }, 1200);
    });
    head.append(copy);
  }

  if (onSchedule) {
    const plan = el("button", "d-act d-plan", scheduled ? "Saved" : "Save");
    plan.prepend(icon(scheduled ? "check" : "plus", 15));
    plan.setAttribute("aria-label", scheduled ? "Remove from schedule" : "Add to schedule");
    plan.title = scheduled ? "Remove from schedule" : "Save to your schedule";
    plan.type = "button";
    plan.setAttribute("aria-pressed", String(Boolean(scheduled)));
    plan.addEventListener("click", onSchedule);
    head.append(plan);
  }
  return head;
}

function spreadBar({ counts, total }) {
  const bar = el("div", "spread");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", counts.map((n, i) => `${n} rated ${i + 1}`).join(", "));
  counts.forEach((n, i) => {
    const segment = el("i", `s${i + 1}`);
    segment.style.width = `${(n / total) * 100}%`;
    segment.title = `${n} rated ${i + 1}`;
    bar.append(segment);
  });
  return bar;
}

function scopeLine({ matched, total, code }) {
  return matched === 0
    ? `None of the ${total} ratings name ${code}.`
    : `${matched} of ${total} ratings ${matched === 1 ? "is" : "are"} for ${code}.`;
}

/**
 * Initials in the same circle the photo would fill.
 *
 * Drawn from the attribute by CSS rather than written as text, so selecting the
 * heading copies "Paolo Bucci" and not "PBPaolo Bucci".
 */
function monogram(person) {
  const mono = el("span", "d-face d-mono");
  mono.dataset.initials = initials(person.name);
  mono.setAttribute("aria-hidden", "true");
  return mono;
}

/**
 * The instructor's photo, or their initials when there is none to show.
 *
 * Most instructors have no photo, so the monogram is the ordinary case rather
 * than a failure state, and it also stands in while the snapshot is still on its
 * way. Decorative either way, since the name follows it.
 */
function instructorFace(person) {
  const url = faceFor(person.email);
  if (!url) return monogram(person);

  const img = el("img", "d-face");
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  // Some photos come back over a megabyte even at 100px, so keep the decode off
  // the main thread.
  img.decoding = "async";
  // Only fires if opic is unreachable. A missing photo is a 302 to a placeholder
  // that loads perfectly well, which is what the snapshot is for.
  img.addEventListener("error", () => img.replaceWith(monogram(person)), { once: true });
  return img;
}

function instructorHeading(people) {
  const heading = el("h2", "d-name");
  people.forEach((person, i) => {
    if (i) heading.append(document.createTextNode(" & "));
    const rating = ratingFor(person.name);
    const link = el("a", "teacher-link", person.name);
    link.href = rating ? profileUrl(rating.legacyId) : searchUrl(person.name);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    heading.append(instructorFace(person), link);
  });
  return heading;
}

/**
 * Every other section this instructor teaches this term.
 *
 * Uses the results already on screen, so it is honest about its own limits:
 * it can only see courses the current search returned. Says so rather than
 * implying it is the instructor's full load.
 */
function alsoTeaches(people, current, entries, term) {
  const names = new Set(people.map((p) => p.name));
  const found = [];
  for (const entry of entries) {
    // Every professor is nominally attached to a dozen independent-study and
    // thesis listings. #17 keeps them out of results; they do not belong here
    // either, or they bury the actual teaching load.
    if (isIndividualStudy(entry)) continue;
    for (const section of entry.sections) {
      if (String(section.classNumber) === String(current.classNumber)) continue;
      if (!instructorsOf(section).some((p) => names.has(p.name))) continue;
      found.push({ entry, section });
    }
  }
  if (!found.length) return null;

  const wrap = block("Also teaches, in these results");
  for (const { entry, section } of found.slice(0, 8)) {
    const seats = seatsFor(section.classNumber, term);
    const label = `${entry.course.subject} ${entry.course.catalogNumber} · ${section.classNumber}`;
    wrap.append(row(label, seats ? `${seats.enrolled}/${seats.limit}` : "—",
      seats?.full ? "is-full" : seats ? "is-open" : "is-none"));
  }
  if (found.length > 8) wrap.append(el("p", "d-note", `and ${found.length - 8} more`));
  return wrap;
}

/** A partner's component, when the current results happen to carry it. */
function componentOf(classNumber, entries) {
  for (const entry of entries ?? []) {
    for (const section of entry.sections) {
      if (String(section.classNumber) === String(classNumber)) return section.component ?? "";
    }
  }
  return "";
}

/** Open first, then unpublished capacity, then full. */
function byOpenness(seats) {
  if (!seats) return 1;
  return seats.full ? 2 : 0;
}

/**
 * One side of a registration package, with each partner's seats.
 *
 * Capped, because a lecture can have three dozen labs under it and the point is
 * to show whether any of them is open, not to reprint the schedule. Which is
 * also why the open ones go first: CHEM 1110 lists ten recitations in class
 * number order and the only one with a seat left is the tenth.
 */
function partners(title, numbers, term, entries) {
  const wrap = block(title);
  const all = numbers.map((number) => ({ number, seats: seatsFor(number, term) }));
  all.sort((a, b) => byOpenness(a.seats) - byOpenness(b.seats));

  for (const { number, seats } of all.slice(0, 8)) {
    const component = componentOf(number, entries);
    wrap.append(row(
      component ? `${number} · ${component}` : String(number),
      seats ? `${seats.enrolled}/${seats.limit}` : "—",
      seats?.full ? "is-full" : seats ? "is-open" : "is-none"
    ));
  }
  if (all.length > 8) wrap.append(el("p", "d-note", `and ${all.length - 8} more`));
  return wrap;
}

/**
 * The eleven marks as one bar, A on the left.
 *
 * Built like spreadBar, but the segments carry a band rather than a score:
 * eleven colours nobody can tell apart would be decoration, and what a student
 * reads off this is how much of it is A, how much is the middle, and how much
 * is E.
 */
function gradeBar({ counts, total }) {
  const bar = el("div", "spread gspread");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", counts.map((n, i) => `${n} got ${SCALE[i]}`).filter((_, i) => counts[i] > 0).join(", "));
  counts.forEach((n, i) => {
    if (!n) return; // a zero segment is a zero-width element with a tooltip nobody can reach
    const segment = el("i", `g${i}`);
    segment.style.width = `${(n / total) * 100}%`;
    segment.title = `${n} got ${SCALE[i]}`;
    bar.append(segment);
  });
  return bar;
}

/**
 * What five years of the registrar's own records say about this instructor in
 * this course. See docs/osu-grades.md.
 *
 * Only for a single named instructor, for the reason the rating block is: a
 * curve averaged across two people is not either person's curve.
 *
 * Every branch here prints a different true sentence rather than a blank. A
 * course whose sections were all too small to publish, a pass-fail course and a
 * course nobody has a record for are three different things, and only the first
 * two are worth saying out loud.
 */
function historicalGrades(person, course) {
  const history = gradeHistory(person, course);
  const wrap = block("Grade history");
  wrap.classList.add("grade-card");
  wrap.append(el("h3", "grade-heading", `${course.subject} ${course.catalogNumber}`));
  wrap.append(el("p", "d-note", `${gradeTermLabel(history[history.length - 1].term)} – ${history[0].label} · Columbus`));

  const label = el("label", "grade-filter");
  label.append(el("span", "visually-hidden", "View distribution"));
  const select = el("select", "grade-select");
  select.setAttribute("aria-label", "Grade distribution term");
  const all = el("option", null, `All ${history.length} terms`);
  all.value = "";
  select.append(all);
  for (const item of history) {
    const option = el("option", null, item.label);
    option.value = item.term;
    select.append(option);
  }
  label.append(select);
  wrap.append(label);
  const content = el("div", "grade-content");
  content.setAttribute("aria-live", "polite");
  wrap.append(content);

  const draw = () => {
    const record = gradeRecord(person, course, select.value);
    const curve = gradeCurveForTerm(person, course, select.value);
    content.replaceChildren();
    if (curve) {
      const figs = el("div", "d-figs grade-figures");
      figs.append(figure(curve.gpa.toFixed(2), "average GPA", "is-rating"),
        figure(`${Math.round(aShare(curve) * 100)}%`, "got A or A-"), figure(curve.n.toLocaleString(), "letter grades"));
      content.append(figs);
      const chart = el("div", "grade-chart");
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", SCALE.map((mark, i) => `${mark}: ${curve.counts[i]} (${Math.round(curve.counts[i] / curve.n * 100)}%)`).join(", "));
      const max = Math.max(...curve.counts);
      SCALE.forEach((mark, i) => {
        const col = el("div", "grade-column");
        const share = Math.round(curve.counts[i] / curve.n * 100);
        col.title = `${mark}: ${curve.counts[i].toLocaleString()} grades (${share}%)`;
        col.append(el("span", "grade-percent", `${share}`));
        const track = el("div", "grade-track");
        const bar = el("i", `grade-fill grade-band-${i < 2 ? "a" : i < 5 ? "b" : i < 8 ? "c" : "e"}`);
        bar.style.height = `${curve.counts[i] / max * 100}%`;
        track.append(bar);
        col.append(track, el("span", "grade-mark", mark));
        chart.append(col);
      });
      content.append(el("p", "grade-chart-caption", "Share of letter grades (%)"), chart);
    } else {
      const marks = Object.entries(record.other).filter(([mark]) => mark !== "EN");
      const primary = marks.sort((a, b) => b[1] - a[1])[0];
      const pass = (record.other.S ?? 0) + (record.other.PA ?? 0) + (record.other.PE ?? 0);
      const headline = el("div", "nonletter-result");
      headline.append(el("strong", null, pass ? `${Math.round(pass / record.enrolled * 100)}%` : primary?.[0] ?? "—"),
        el("span", null, pass ? "Satisfactory / pass" : "Recorded outcomes"));
      content.append(headline, el("p", "d-note", "No letter grades in this selection. This course uses other recorded marks."));
    }
    content.append(el("p", "grade-sample", `${record.sections.toLocaleString()} ${record.sections === 1 ? "class" : "classes"} · ${record.enrolled.toLocaleString()} recorded enrollments`));
    if (record.other.W) content.append(row("Withdrew", `${record.other.W.toLocaleString()} (${Math.round(record.other.W / record.enrolled * 100)}% of enrollments)`));
    if (record.coTaught) content.append(el("p", "d-note", `${record.coTaught} ${record.coTaught === 1 ? "class was" : "classes were"} team-taught. These are whole-class outcomes shared by the listed instructors.`));

    const details = el("details", "grade-details");
    details.append(el("summary", null, "Grade breakdown"));
    const table = el("table", "grade-table");
    const caption = el("caption", "visually-hidden", "Grade counts and share of all recorded enrollments");
    table.append(caption);
    const head = el("tr");
    for (const text of ["Grade", "Count", "Share"]) { const th = el("th", null, text); th.setAttribute("scope", "col"); head.append(th); }
    const thead = el("thead"); thead.append(head); table.append(thead);
    const body = el("tbody");
    const outcomes = SCALE.map((m, i) => [m === "E" ? "E (includes EN)" : m, record.counts[i]]);
    outcomes.push(...Object.entries(record.other).filter(([m]) => m !== "EN"));
    for (const [mark, count] of outcomes) {
      const tr = el("tr");
      const th = el("th", null, mark); th.setAttribute("scope", "row");
      tr.append(th, el("td", null, count.toLocaleString()), el("td", null, `${(count / record.enrolled * 100).toFixed(1)}%`));
      body.append(tr);
    }
    table.append(body); details.append(table);
    if (record.other.EN) details.append(el("p", "d-note", `${record.other.EN.toLocaleString()} EN (non-attendance) grades are included in E and the GPA.`));
    details.append(el("p", "d-note", "GPA and A share use letter grades only. Table shares use all recorded enrollments. Other marks carry no grade points."));
    content.append(details);
  };
  select.addEventListener("change", draw);
  draw();

  const timeline = el("details", "grade-details");
  timeline.append(el("summary", null, "Compare terms"));
  const hasLetters = history.some(({ curve }) => curve != null);
  const table = el("table", "grade-table");
  table.append(el("caption", "visually-hidden", hasLetters ? "Historical average GPA, A share and letter grade counts by term" : "Recorded outcomes and enrollments by term"));
  const thead = el("thead"); const tr = el("tr");
  for (const text of hasLetters ? ["Term", "GPA", "A / A-", "Grades"] : ["Term", "Outcomes", "Enrolled"]) { const th = el("th", null, text); th.setAttribute("scope", "col"); tr.append(th); }
  thead.append(tr); table.append(thead);
  const tbody = el("tbody");
  for (const { label: name, curve, row: record } of history) {
    const tr = el("tr"); const th = el("th", null, name); th.setAttribute("scope", "row");
    if (hasLetters) tr.append(th, el("td", null, curve?.gpa.toFixed(2) ?? "—"), el("td", null, curve ? `${Math.round(aShare(curve) * 100)}%` : "—"), el("td", null, (curve?.n ?? 0).toLocaleString()));
    else tr.append(th, el("td", null, Object.entries(record.other).filter(([mark]) => mark !== "EN").map(([mark, n]) => `${mark} ${n}`).join(" · ")), el("td", null, record.enrolled.toLocaleString()));
    tbody.append(tr);
  }
  table.append(tbody); timeline.append(table); wrap.append(timeline);
  const methodology = el("details", "grade-methodology");
  methodology.append(el("summary", null, "Source & coverage"), el("p", "grade-footnote", "Official OSU records, 2018–2026. Classes under 10 students and student instructors are omitted. Historical outcomes are not a prediction."));
  const source = el("a", "grade-source", "About these records ↗");
  source.href = "https://github.com/EnesYilmazcode/Finder/blob/main/docs/osu-grades.md";
  source.target = "_blank"; source.rel = "noopener noreferrer";
  methodology.append(source); wrap.append(methodology);
  return wrap;
}

function gradeBlock(person, course) {
  const state = gradeLoadState(course);
  if (state !== "ready") {
    const wrap = block("Grades · official OSU records");
    wrap.append(el("p", "d-note", state === "loading" ? "Loading historical grades…" : "Grade history could not load. Open this section again to retry."));
    return wrap;
  }
  if (gradeHistory(person, course).length) return historicalGrades(person, course);
  const status = gradesStatus(person, course);
  // Nothing to say: either the file is not published or it does not know this
  // pairing. Neither is evidence about how anyone grades.
  if (status === "unknown" && gradesRelease()) {
    const wrap = block("Grades · official OSU records");
    wrap.append(el("p", "d-note", "No matching historical record for this instructor and course. Small classes and student instructors were omitted by OSU; names without a clear match are left unmatched."));
    return wrap;
  }
  if (status === "unknown" || status === "unpublished") return null;

  const range = gradesRange();
  const wrap = block(range ? `Grades, ${range.first} to ${range.last}` : "Grades");

  if (status === "withheld") {
    const n = withheldFor(person, course);
    wrap.append(el("p", "d-note",
      `Ohio State withheld this curve: all ${n} of their sections were small enough that a distribution could identify someone.`));
    return wrap;
  }
  if (status === "ungraded") {
    wrap.append(el("p", "d-note", "This course is graded satisfactory or unsatisfactory, so there is no curve to draw."));
    return wrap;
  }

  const curve = gradesFor(person, course);
  if (!curve) return null;

  const figs = el("div", "d-figs");
  figs.append(figure(curve.gpa.toFixed(2), "average GPA", "is-rating"));
  figs.append(figure(`${Math.round(aShare(curve) * 100)}%`, "got A or A-"));
  figs.append(figure(String(curve.n), "graded"));
  wrap.append(figs);

  const spread = gradeSpread(curve);
  if (spread) {
    wrap.append(gradeBar(spread));
    wrap.append(el("div", "d-cap spread-cap", "A to E, left to right"));
  }

  // Withdrawals are outside the mean by definition, which is exactly why they
  // belong on screen: a course half the class drops has a flattering average.
  if (curve.withdrew > 0) {
    const share = Math.round((curve.withdrew / (curve.n + curve.withdrew)) * 100);
    wrap.append(row("Withdrew", `${curve.withdrew} of ${curve.n + curve.withdrew} (${share}%)`,
      share >= 15 ? "is-full" : null));
  }

  const terms = curve.terms === 1 ? "one term" : `${curve.terms} terms`;
  const sections = curve.sections === 1 ? "one section" : `${curve.sections} sections`;
  wrap.append(el("p", "d-note", `Across ${sections} over ${terms}.`));

  if (curve.suppressed > 0) {
    wrap.append(el("p", "d-note",
      `${curve.suppressed} more ${curve.suppressed === 1 ? "section was" : "sections were"} too small to publish, so they are not in this curve.`));
  }
  // One section is one cohort. The same professor teaching the same course to
  // honours students and to a summer section produces two different curves, and
  // a single one cannot be told from either.
  if (curve.n < 30) {
    wrap.append(el("p", "d-note", `Only ${curve.n} graded students, so treat this as thin evidence.`));
  }

  return wrap;
}

export function renderDetail({ section, course, term, entries, formatDate, shareUrl, scheduled = false, onSchedule }) {
  const wrap = document.createDocumentFragment();
  const people = instructorsOf(section);

  wrap.append(people.length ? instructorHeading(people) : el("h2", "d-name is-none", "Instructor not listed"));

  const units = formatUnits(course);
  const bits = [`${course.subject} ${course.catalogNumber}`, section.component, units].filter(Boolean);
  wrap.append(el("p", "d-sub", bits.join(" · ")));
  wrap.append(sectionHead(section, course, shareUrl, scheduled, onSchedule));
  const hasHistory = people.length === 1 && gradeHistory(people[0], course).length > 0;
  if (hasHistory) wrap.append(gradeBlock(people[0], course));

  // Ratings only make sense for a single named instructor. Co-taught sections
  // get no combined figure, because averaging two people is not a rating.
  const rating = people.length === 1 ? ratingFor(people[0].name) : null;
  const reviews = el("details", "review-details");
  if (rating) {
    reviews.append(el("summary", null, `Student reviews · ${Number(rating.avgRating).toFixed(1)} / 5 · ${rating.numRatings} ratings`));
    const figs = el("div", "d-figs");
    figs.append(figure(Number(rating.avgRating).toFixed(1), `${rating.numRatings} ratings`, "is-rating"));
    if (rating.avgDifficulty != null) figs.append(figure(Number(rating.avgDifficulty).toFixed(1), "difficulty"));
    if (rating.wouldTakeAgainPercent != null && rating.wouldTakeAgainPercent >= 0) {
      figs.append(figure(`${Math.round(rating.wouldTakeAgainPercent)}%`, "take again"));
    }
    reviews.append(figs);

    const spread = ratingSpread(rating);
    if (spread) {
      reviews.append(spreadBar(spread));
      reviews.append(el("div", "d-cap spread-cap", "1 to 5, left to right"));
    }
    // Null while data/ratings-courses.json is still on its way. app.js redraws.
    const share = courseShare(rating, course);
    if (share) reviews.append(el("p", "d-note", scopeLine(share)));

    if (rating.numRatings < 5) {
      reviews.append(el("p", "d-note", `Only ${rating.numRatings} ratings, so treat this as thin evidence.`));
    }
  }
  if (rating) wrap.append(reviews);

  // Grades sit under the ratings because they answer the same question from the
  // other side: what students said, then what the registrar recorded.
  if (people.length === 1 && !hasHistory) {
    const curve = gradeBlock(people[0], course);
    if (curve) wrap.append(curve);
  }

  const flags = sectionFlags(section);
  if (flags.length) {
    const worth = block("Worth knowing");
    for (const flag of flags) worth.append(el("p", "d-note", flag.detail));
    wrap.append(worth);
  }

  const seats = seatsFor(section.classNumber, term);
  const seatBlock = block("Seats");
  if (seats) {
    const bar = el("div", "bar");
    const fill = el("i", seats.full ? "f" : null);
    fill.style.width = `${Math.min(100, seats.limit ? (seats.enrolled / seats.limit) * 100 : 0)}%`;
    bar.append(fill);
    seatBlock.append(bar);
    seatBlock.append(row("Enrolled", `${seats.enrolled} / ${seats.limit}`, seats.full ? "is-full" : "is-open"));
    seatBlock.append(row("Waitlist", seats.waitlist > 0 ? `${seats.waitlist} waiting` : "none",
      seats.waitlist > 0 ? "is-full" : null));

    // A full section gets the waitlist series and nothing else. Its enrolment
    // is free to move, but calling that movement "seats" under a row reading
    // 40 / 40 would tell a student a full section is open.
    const moved = seats.full
      ? trendFor(section.classNumber, term, "waitlist")
      : trendFor(section.classNumber, term);
    if (moved) {
      const line = row("Trend", trendLabel(moved), moved.change > 0 ? "is-full" : "is-open");
      line.title = `${moved.points} snapshots moved between ${moved.from} and ${moved.to}.`;
      seatBlock.append(line);
    }

    const asOf = seatsUpdated(term);
    if (asOf) seatBlock.append(row("As of", formatDate ? formatDate(asOf) : asOf));
  } else {
    seatBlock.append(el("p", "d-note", "No seat data for this section."));
  }
  // Free seats a package puts out of reach are the ones "hide full" drops and
  // the row refuses to badge. The pane explains rather than hides, so it is the
  // one place that says why. #67.
  if (unreachable(section.classNumber, term)) {
    seatBlock.append(el("p", "d-note", "This section cannot be registered: another section in its package is full."));
  }
  wrap.append(seatBlock);

  const linked = linkedTo(section.classNumber, term);
  if (linked?.enrolls.length) {
    wrap.append(partners("Also enrolls you in", linked.enrolls, term, entries));
  }
  if (linked?.enrolledBy.length) {
    wrap.append(partners("Register through one of these", linked.enrolledBy, term, entries));
  }

  const meets = block("Meets");
  // The [null] keeps a section with nothing scheduled printing Time to be
  // announced. See #82.
  const meetings = distinctMeetings(section);
  for (const meeting of meetings.length ? meetings : [null]) {
    meets.append(row("When", formatWhen(meeting)));
    const room = meeting?.buildingDescription || meeting?.facilityDescription;
    if (room) meets.append(row("Room", room));
  }
  if (section.instructionMode) meets.append(row("Mode", section.instructionMode));
  if (section.startDate && section.endDate) meets.append(row("Runs", `${section.startDate} to ${section.endDate}`));
  wrap.append(meets);

  const attributes = attributesOf(course, section);
  if (attributes.length) {
    const attrBlock = block("Attributes");
    for (const attribute of attributes) {
      const line = el("div", "d-attr");
      const badge = el("span", "flag", attributeLabel(attribute));
      badge.dataset.flag = attribute.name;
      line.append(badge);
      if (attribute.description) line.append(el("span", "d-attr-desc", attribute.description));
      attrBlock.append(line);
    }
    if (attributes.some((a) => a.name === "GE")) {
      attrBlock.append(el("p", "d-note", "Legacy GE codes are the old curriculum. Your catalog year decides which set you can count."));
    }
    wrap.append(attrBlock);
  }

  const also = alsoTeaches(people, section, entries, term);
  if (also) wrap.append(also);

  const description = course.description ?? section.courseDescription;
  if (description) {
    const about = block("About the course");
    about.append(el("p", "d-prose", description));
    wrap.append(about);
  }

  return wrap;
}
