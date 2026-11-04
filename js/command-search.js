import { loadCourses } from './courses.js';
import { loadGrades, gradeNameKey } from './grades.js';
import { loadRatings } from './ratings.js';
import { loadHeadshots, faceFor, initials } from './headshots.js';
import { searchAllPages } from './api.js';
import { instructorsOf } from './format.js';
import { searchChoices, searchScore } from './search-index.js';
import { icon } from './icons.js';

export function initCommandSearch() {
  const dialog = document.querySelector('#search-dialog');
  if (typeof dialog?.showModal !== 'function') return;
  const input = document.querySelector('#q');
  const term = document.querySelector('#term');
  const form = document.querySelector('#search');
  const launch = document.querySelector('#search-launch');
  const label = document.querySelector('#search-label');
  const options = document.querySelector('#search-options');
  const feedback = document.querySelector('#search-feedback');
  const people = new Map();
  let catalog = null, prepared = null, preparing = false, active = -1, current = [], generation = 0, timer = 0;
  let returnFocus = launch, closing = false, navigated = false;

  launch.querySelector('.search-launch-icon').replaceChildren(icon('search', 20));
  document.querySelector('#palette-search-icon').append(icon('search', 22));
  launch.querySelector('kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  for (const [id, name] of [['rail-toggle', 'filter'], ['filter-close', 'close'], ['detail-back', 'close']]) {
    const button = document.querySelector(`#${id}`);
    button.replaceChildren(icon(name));
    if (id === 'rail-toggle') button.append(document.createTextNode('Filters'));
    button.title = button.getAttribute('aria-label') ?? 'Filters';
  }
  for (const [id, name, text] of [['view-list', 'list', 'List'], ['view-cal', 'calendar', 'Calendar']]) {
    const button = document.querySelector(`#${id}`);
    button.replaceChildren(icon(name, 16), document.createTextNode(text));
  }
  const scheduleButton = document.querySelector('#view-schedule');
  scheduleButton.prepend(icon('calendar', 16));

  function remember(person, source) {
    const key = gradeNameKey(person.name);
    if (!key) return;
    const old = people.get(key);
    people.set(key, { ...old, kind: 'person', label: person.name,
      extra: person.department ?? old?.extra ?? '', email: person.email ?? old?.email,
      detail: person.department || source || old?.detail || 'Professor' });
  }

  async function prepare() {
    if (prepared) return prepared;
    preparing = true;
    feedback.textContent = 'Loading courses and professors…';
    prepared = Promise.allSettled([
      loadCourses().then((data) => { catalog = data; }),
      loadGrades().then((idx) => {
        for (const person of Object.values(idx?.meta?.instructors ?? {})) remember(person, 'Historical grade records');
      }),
      loadRatings().then((idx) => {
        for (const list of idx.byKey.values()) for (const p of list)
          remember({ name: `${p.firstName} ${p.lastName}`, department: p.department }, 'Student ratings');
      }),
      loadHeadshots(),
    ]).then((results) => {
      preparing = false;
      if (results.some((r) => r.status === 'rejected')) {
        prepared = null;
        feedback.textContent = 'Some suggestions are unavailable. You can still search.';
      } else feedback.textContent = '';
      if (dialog.open) render();
    });
    return prepared;
  }

  function choices() {
    const courses = [];
    for (const subject of catalog?.terms?.[term.value]?.subjects ?? []) {
      for (const [number, title] of subject.courses ?? []) courses.push({ kind: 'course',
        label: `${subject.code} ${number}`, extra: `${title} ${subject.name}`, detail: title });
    }
    return [...courses, ...people.values()];
  }

  function setActive(index) {
    active = index;
    [...options.children].forEach((node, i) => {
      node.classList.toggle('is-active', i === active);
      node.setAttribute('aria-selected', String(i === active));
    });
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `search-option-${active}`);
      options.children[active]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function choose(choice) {
    input.value = choice.label;
    input.dataset.person = choice.kind === 'person' ? choice.label : '';
    form.requestSubmit();
  }

  function render(preserveSelection = false) {
    const selected = preserveSelection && navigated ? current[active] : null;
    const q = input.value.trim();
    current = q ? searchChoices(q, choices()) : [
      { kind: 'course', label: 'CSE 2221', detail: 'Software I: Software Components' },
      { kind: 'course', label: 'MATH 1151', detail: 'Calculus I' },
      { kind: 'course', label: 'ENGLISH 1110', detail: 'First-Year English Composition' },
    ];
    options.replaceChildren();
    for (const [i, choice] of current.entries()) {
      const node = document.createElement('div');
      node.id = `search-option-${i}`; node.className = 'search-option'; node.setAttribute('role', 'option');
      const avatar = document.createElement('span');
      avatar.className = choice.kind === 'person' ? 'search-avatar' : 'search-course-icon';
      if (choice.kind === 'person') {
        avatar.textContent = initials(choice.label);
        const url = faceFor(choice.email);
        if (url) {
          const img = document.createElement('img'); img.src = url; img.alt = ''; img.loading = 'lazy';
          img.addEventListener('error', () => img.remove(), { once: true }); avatar.append(img);
        }
      } else avatar.append(icon('book', 19));
      const text = document.createElement('span'); text.className = 'search-option-text';
      const name = document.createElement('strong'); name.textContent = choice.label;
      const detail = document.createElement('small'); detail.textContent = choice.detail;
      text.append(name, detail);
      const kind = document.createElement('span'); kind.className = 'search-kind';
      kind.textContent = choice.kind === 'person' ? 'Professor' : 'Course';
      node.append(avatar, text, kind, icon('arrow', 16));
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => choose(choice));
      node.addEventListener('pointermove', () => { navigated = true; setActive(i); });
      options.append(node);
    }
    if (!current.length) {
      feedback.textContent = preparing ? 'Loading suggestions…' : 'No close matches. Enter to search the live catalog.';
    } else feedback.textContent = q ? `${current.length} ${current.length === 1 ? 'suggestion' : 'suggestions'}` : 'Try a course, a name, or a subject';
    input.setAttribute('aria-expanded', 'true');
    const previous = selected ? current.findIndex((choice) => choice.kind === selected.kind && choice.label === selected.label) : -1;
    setActive(previous >= 0 ? previous : current.length ? 0 : -1);
  }

  async function enrich(query, version) {
    if (/\d/.test(query) || query.length < 3) return;
    try {
      const result = await searchAllPages({ q: query, term: term.value, maxPages: 2 });
      if (version !== generation || !dialog.open) return;
      for (const entry of result.courses) for (const section of entry.sections ?? []) {
        for (const person of instructorsOf(section)) {
          if (searchScore(query, person.name) > 0) remember(person, 'Teaching this term');
        }
      }
      render(true);
    } catch { /* Local suggestions remain usable during an API outage. */ }
  }

  function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement === document.body ? launch : document.activeElement;
    navigated = false;
    if (document.querySelector('.app').dataset.rail === 'open') document.querySelector('#rail-toggle').click();
    dialog.showModal(); input.focus(); input.select(); render(); prepare();
    const version = ++generation;
    clearTimeout(timer); timer = setTimeout(() => enrich(input.value.trim(), version), 280);
  }
  function close() {
    if (!dialog.open || closing) return;
    closing = true; dialog.dataset.closing = 'true';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { dialog.close(); delete dialog.dataset.closing; closing = false; }, reduced ? 0 : 110);
  }
  launch.addEventListener('click', open);
  document.querySelector('#search-close').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    ++generation; clearTimeout(timer); input.setAttribute('aria-expanded', 'false');
    returnFocus?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); dialog.open ? close() : open(); }
  });
  document.addEventListener('pointerdown', (event) => {
    if (document.querySelector('.app').dataset.rail === 'open' && !event.target.closest('#rail, #rail-toggle'))
      document.querySelector('#rail-toggle').click();
  });
  input.addEventListener('input', () => {
    input.dataset.person = ''; navigated = false; render(); const version = ++generation;
    clearTimeout(timer); timer = setTimeout(() => enrich(input.value.trim(), version), 280);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      navigated = true;
      if (current.length) setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + current.length) % current.length);
    } else if (event.key === 'Enter' && active >= 0 && current[active]) {
      event.preventDefault(); choose(current[active]);
    }
  });
  document.querySelector('#go').addEventListener('click', (event) => {
    if (active >= 0 && current[active]) { event.preventDefault(); choose(current[active]); }
  });
  form.addEventListener('submit', () => {
    label.textContent = input.value.trim() || 'Search courses & professors'; close();
  });
  term.addEventListener('change', () => { if (dialog.open) render(); });
  const syncLabel = () => { label.textContent = input.value.trim() || 'Search courses & professors'; };
  new MutationObserver(syncLabel).observe(document.querySelector('#results'), { childList: true });
  syncLabel();
  document.querySelector('#filter-close').addEventListener('click', () => {
    if (document.querySelector('.app').dataset.rail === 'open') document.querySelector('#rail-toggle').click();
    document.querySelector('#rail-toggle').focus();
  });
  document.querySelector('#rail-toggle').addEventListener('click', () => {
    setTimeout(() => {
      if (document.querySelector('.app').dataset.rail === 'open') document.querySelector('#filter-close').focus();
    }, 0);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.open && document.querySelector('.app').dataset.rail === 'open') document.querySelector('#filter-close').click();
  });
}
