export const SYLLABUS_LIBRARY_URL = "https://osu.simplesyllabus.com/en-US/syllabus-library";

export function termLabel(strm) {
  const match = /^(\d)(\d{2})([248])$/.exec(String(strm ?? ""));
  if (!match) return String(strm ?? "");
  const year = 2000 + Number(match[2]);
  const season = { 2: "Spring", 4: "Summer", 8: "Autumn" }[match[3]];
  return season ? `${season} ${year}` : String(strm);
}

export function publicSyllabusExpected(course, term = "1268") {
  const level = Number.parseInt(String(course?.catalogNumber ?? ""), 10);
  return Number.isFinite(level) && level <= 5999 && Number(term) >= 1268;
}
