// The right pane. Everything here already exists in memory by the time a
// section is selected, so nothing fetches.

import { formatWhen, formatUnits, instructorsOf } from "./format.js";
import { ratingFor, searchUrl, profileUrl } from "./ratings.js";
import { seatsFor, seatsUpdated } from "./seats.js";
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
    if (rating.numRatings < 5) {
      wrap.append(el("p", "d-note", `Only ${rating.numRatings} ratings, so treat this as thin evidence.`));
    }
  } else if (people.length === 1) {
    wrap.append(el("p", "d-note", "No RateMyProfessors ratings. Their name links to a search."));
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
    const asOf = seatsUpdated(term);
    if (asOf) seatBlock.append(row("As of", formatDate ? formatDate(asOf) : asOf));
  } else {
    seatBlock.append(el("p", "d-note", "No seat data for this section."));
  }
  wrap.append(seatBlock);

  const meeting = section.meetings?.[0] ?? null;
  const meets = block("Meets");
  meets.append(row("When", formatWhen(meeting)));
  const room = meeting?.buildingDescription || meeting?.facilityDescription;
  if (room) meets.append(row("Room", room));
  if (section.instructionMode) meets.append(row("Mode", section.instructionMode));
  if (section.startDate && section.endDate) meets.append(row("Runs", `${section.startDate} to ${section.endDate}`));
  wrap.append(meets);

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
