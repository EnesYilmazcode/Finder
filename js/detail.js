// The right pane. Nothing here fetches. The course codes it reads are the one
// thing not already in memory when a section is selected, and app.js redraws
// the body once they land.

import { formatWhen, formatUnits, instructorsOf, attributesOf, attributeLabel, sectionFlags, trendLabel } from "./format.js";
import { ratingFor, searchUrl, profileUrl, ratingSpread, courseShare } from "./ratings.js";
import { linkedTo, seatsFor, seatsUpdated, unreachable } from "./seats.js";
import { trendFor } from "./trend.js";
import { isIndividualStudy } from "./rank.js";

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
 * The class number and the two things students do with it: type it into
 * BuckeyeLink, and send the section to a friend.
 */
function sectionHead(section, course, shareUrl) {
  const head = el("div", "d-head");
  head.append(el("p", "eyebrow", `Section ${section.classNumber}`));

  // navigator.clipboard is undefined on plain http, so the button is only
  // drawn where it can do something.
  if (navigator.clipboard) {
    const label = "Copy number";
    const copy = el("button", "d-act", label);
    copy.type = "button";
    // The label is the only feedback there is, so it has to be spoken too.
    copy.setAttribute("aria-live", "polite");
    let timer = 0;
    copy.addEventListener("click", async () => {
      const done = await navigator.clipboard.writeText(String(section.classNumber)).then(() => true, () => false);
      copy.textContent = done ? "Copied" : "Copy failed";
      // Restart the flash rather than let the last click's timer cut it short.
      clearTimeout(timer);
      timer = setTimeout(() => { copy.textContent = label; }, 1200);
    });
    head.append(copy);
  }

  if (shareUrl && navigator.share) {
    const share = el("button", "d-act", "Share");
    share.type = "button";
    share.addEventListener("click", () => {
      // Dismissing the sheet rejects, and that is not a failure.
      navigator.share({
        title: `${course.subject} ${course.catalogNumber} section ${section.classNumber}`,
        url: shareUrl,
      }).catch(() => {});
    });
    head.append(share);
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

function instructorHeading(people) {
  const heading = el("h2", "d-name");
  people.forEach((person, i) => {
    if (i) heading.append(document.createTextNode(" & "));
    const rating = ratingFor(person.name);
    const link = el("a", "teacher-link", person.name);
    link.href = rating ? profileUrl(rating.legacyId) : searchUrl(person.name);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    heading.append(link);
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

export function renderDetail({ section, course, term, entries, formatDate, shareUrl }) {
  const wrap = document.createDocumentFragment();
  const people = instructorsOf(section);

  wrap.append(sectionHead(section, course, shareUrl));
  wrap.append(people.length ? instructorHeading(people) : el("h2", "d-name is-none", "Instructor not listed"));

  const units = formatUnits(course);
  const bits = [`${course.subject} ${course.catalogNumber}`, section.component, units].filter(Boolean);
  wrap.append(el("p", "d-sub", bits.join(" · ")));

  // Ratings only make sense for a single named instructor. Co-taught sections
  // get no combined figure, because averaging two people is not a rating.
  const rating = people.length === 1 ? ratingFor(people[0].name) : null;
  if (rating) {
    const figs = el("div", "d-figs");
    figs.append(figure(Number(rating.avgRating).toFixed(1), `${rating.numRatings} ratings`, "is-rating"));
    if (rating.avgDifficulty != null) figs.append(figure(Number(rating.avgDifficulty).toFixed(1), "difficulty"));
    if (rating.wouldTakeAgainPercent != null && rating.wouldTakeAgainPercent >= 0) {
      figs.append(figure(`${Math.round(rating.wouldTakeAgainPercent)}%`, "take again"));
    }
    wrap.append(figs);

    const spread = ratingSpread(rating);
    if (spread) {
      wrap.append(spreadBar(spread));
      wrap.append(el("div", "d-cap spread-cap", "1 to 5, left to right"));
    }
    // Null while data/ratings-courses.json is still on its way. app.js redraws.
    const share = courseShare(rating, course);
    if (share) wrap.append(el("p", "d-note", scopeLine(share)));

    if (rating.numRatings < 5) {
      wrap.append(el("p", "d-note", `Only ${rating.numRatings} ratings, so treat this as thin evidence.`));
    }
  } else if (people.length === 1) {
    wrap.append(el("p", "d-note", "No RateMyProfessors ratings. Their name links to a search."));
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

  const meeting = section.meetings?.[0] ?? null;
  const meets = block("Meets");
  meets.append(row("When", formatWhen(meeting)));
  const room = meeting?.buildingDescription || meeting?.facilityDescription;
  if (room) meets.append(row("Room", room));
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
