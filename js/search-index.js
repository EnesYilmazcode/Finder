// Local, deterministic search ranking. Every query word must match; a shared
// first name never makes a different professor a result.
export const normalizeSearch = (value) => String(value ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function closeWord(a, b) {
  if (a === b || b.startsWith(a)) return true;
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  // One edit or one adjacent transposition, bounded by word length.
  if (a.length === b.length) {
    const different = [...a].map((c, i) => c === b[i] ? -1 : i).filter((i) => i >= 0);
    return different.length === 1 || (different.length === 2 && different[1] === different[0] + 1
      && a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]]);
  }
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

export function searchScore(query, label, extra = '') {
  const q = normalizeSearch(query);
  const name = normalizeSearch(label);
  if (!q) return 0;
  if (name === q || name.replaceAll(' ', '') === q.replaceAll(' ', '')) return 1000;
  if (/^[a-z]+\d/.test(q.replaceAll(' ', '')) && name.replaceAll(' ', '').startsWith(q.replaceAll(' ', ''))) return 825;
  if (name.startsWith(q)) return 850 - name.length / 100;
  const words = `${name} ${normalizeSearch(extra)}`.split(' ');
  const tokens = q.split(' ');
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 650 - name.length / 100;
  if (tokens.every((token) => words.some((word) => closeWord(token, word)))) return 350 - name.length / 100;
  return 0;
}

export function searchChoices(query, choices, limit = 9) {
  if (!normalizeSearch(query)) return [];
  return choices.map((choice) => ({ ...choice, score: searchScore(query, choice.label, choice.extra) }))
    .filter((choice) => choice.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function instructorMatches(name, query) {
  const words = normalizeSearch(name).split(' ');
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => words.includes(token));
}
