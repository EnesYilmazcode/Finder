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

/** Pull a bare subject code out of whatever the picker input holds. */
export function codeFromInput(text) {
  return String(text ?? "").trim().split(/[\s—-]/)[0].toUpperCase();
}
