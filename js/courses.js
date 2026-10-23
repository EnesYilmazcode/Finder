// The course index, used by the subject and number pickers.
//
// Loaded lazily. It is 177 KB gzipped and is only needed once someone opens a
// picker, so it stays out of the cold-load path where ratings and seats live.

let index = null;
let loading = null;

export async function loadCourses(url = "data/courses.json") {
  if (index) return index;
  if (loading) return loading;

  loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`courses ${response.status}`);
    index = await response.json();
    return index;
  })().catch((error) => {
    // A cached rejection would pin the failure for the life of the tab.
    loading = null;
    throw error;
  });

  return loading;
}

export function isLoaded() {
  return Boolean(index);
}

/** Subjects offered in a term, sorted by code. */
export function subjectsFor(term) {
  const subjects = index?.terms?.[String(term)]?.subjects ?? [];
  return [...subjects].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Label for a subject.
 *
 * 15 subjects have no name upstream and fall back to their own code, so
 * "CYBRSEC" would otherwise render as "CYBRSEC CYBRSEC".
 */
export function subjectLabel(subject) {
  if (!subject) return "";
  return subject.name && subject.name !== subject.code
    ? `${subject.code} — ${subject.name}`
    : subject.code;
}

/** Courses for one subject code, in catalog order. */
export function coursesFor(term, code) {
  const subject = subjectsFor(term).find((s) => s.code === String(code ?? "").toUpperCase());
  if (!subject) return [];
  return (subject.courses ?? []).map(([number, title, min, max]) => ({ number, title, min, max }));
}

function choice(subject, course) {
  const code = `${subject.code} ${course.number}`;
  return { key: code, code, title: course.title, codes: [code], family: false };
}

/**
 * Term-scoped course choices for the schedule builder.
 *
 * Matches partial catalog numbers and title words, since the point of this
 * control is remembering neither the whole number nor the registrar's exact
 * title. An unsuffixed number with decimal variants also gets one explicit
 * "any version" choice; the variants remain separate choices underneath it.
 */
export function courseSuggestions(term, raw, limit = 8) {
  const query = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!query) return [];
  const upper = query.toUpperCase();
  const allSubjects = subjectsFor(term);
  const firstSpace = upper.indexOf(" ");
  const first = firstSpace < 0 ? upper : upper.slice(0, firstSpace);
  const exactSubject = allSubjects.find((subject) => subject.code === first) ?? null;
  const rest = exactSubject ? upper.slice(first.length).trim() : upper;
  const ranked = [];

  for (const subject of exactSubject ? [exactSubject] : allSubjects) {
    for (const course of coursesFor(term, subject.code)) {
      const number = String(course.number).toUpperCase();
      const title = String(course.title ?? "").toUpperCase();
      const code = `${subject.code} ${number}`;
      let score = 0;
      if (upper === code) score = 120;
      else if (exactSubject && number.startsWith(rest)) score = 100 - Math.min(20, number.length - rest.length);
      else if (!exactSubject && number.startsWith(upper)) score = 88 - Math.min(20, number.length - upper.length);
      else if (title.startsWith(rest)) score = exactSubject ? 82 : 78;
      else if (rest && title.includes(rest)) score = exactSubject ? 72 : 68;
      else if (!exactSubject && code.includes(upper)) score = 60;
      if (score) ranked.push({ score, value: choice(subject, course) });
    }
  }

  // ENGLISH 1110 is a useful request even though only 1110.01 and 1110.02 are
  // offered. Make that choice explicit rather than calling the base missing or
  // silently pretending the two catalog entries are one course.
  const familyMatch = /^([A-Z]{2,8})\s+(\d{3,4})$/.exec(upper);
  if (familyMatch) {
    const [, subjectCode, stem] = familyMatch;
    const variants = coursesFor(term, subjectCode).filter((course) => String(course.number).startsWith(`${stem}.`));
    const exact = coursesFor(term, subjectCode).some((course) => String(course.number) === stem);
    if (!exact && variants.length) {
      ranked.push({
        score: 130,
        value: {
          key: `${subjectCode} ${stem}.*`,
          code: `${subjectCode} ${stem}`,
          title: `Any ${stem} version`,
          codes: variants.map((course) => `${subjectCode} ${course.number}`),
          family: true,
        },
      });
    }
  }

  const unique = new Map();
  for (const found of ranked.sort((a, b) => b.score - a.score || a.value.code.localeCompare(b.value.code))) {
    if (!unique.has(found.value.key)) unique.set(found.value.key, found.value);
  }
  return [...unique.values()].slice(0, Math.max(1, limit));
}

/** Pull a bare subject code out of whatever the picker input holds. */
export function codeFromInput(text) {
  return String(text ?? "").trim().split(/[\s—-]/)[0].toUpperCase();
}
