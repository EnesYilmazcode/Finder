// Small, local SVG set. No icon font, external script, or image requests.
const paths = {
  search: ['M21 21l-4.5-4.5', 'M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0'],
  filter: ['M4 7h16M4 17h16', 'M9 4v6M15 14v6'],
  close: ['M6 6l12 12M18 6 6 18'],
  arrow: ['M5 12h14M13 6l6 6-6 6'],
  back: ['M19 12H5M11 6l-6 6 6 6'],
  chevron: ['M9 5l7 7-7 7'],
  down: ['m6 9 6 6 6-6'],
  book: ['M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15'],
  calendar: ['M5 5h14v16H5zM8 2v6M16 2v6M5 10h14M8 14h2M14 14h2M8 17h2'],
  list: ['M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1'],
  plus: ['M12 5v14M5 12h14'],
  check: ['m5 12 4 4L19 6'],
  copy: ['M9 9h12v12H9zM15 5V3H3v12h2'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'],
};

export function icon(name, size = 18) {
  if (!document.createElementNS) {
    const fallback = document.createElement('span');
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(key, value);
  for (const d of paths[name] ?? paths.search) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
