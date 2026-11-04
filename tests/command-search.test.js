import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, searchChoices, searchScore, instructorMatches } from '../js/search-index.js';
import { filterInstructorCourses } from '../js/rank.js';
import { entry, taught } from './fixtures.js';

const choices = [
  { kind: 'person', label: 'Lisa Nguyen', detail: 'Professor' },
  { kind: 'person', label: 'Alisa Paulsen', detail: 'Professor' },
  { kind: 'person', label: 'Lisa D Pinkerton', detail: 'Professor' },
  { kind: 'person', label: 'Paolo Bucci', detail: 'Professor' },
  { kind: 'course', label: 'CSE 2221', extra: 'Software I: Software Components' },
  { kind: 'course', label: 'CSE 2231', extra: 'Software II: Software Development' },
];

test('all words must match a professor; a shared first name never suffices', () => {
  assert.deepEqual(searchChoices('Lisa Nguyen', choices).map((c) => c.label), ['Lisa Nguyen']);
  assert.equal(searchScore('Lisa Nguyen', 'Alisa Paulsen'), 0);
  assert.equal(searchScore('Lisa Nguyen', 'Lisa Pinkerton'), 0);
});

test('compact codes, partial words, and small transpositions are useful suggestions', () => {
  assert.equal(searchChoices('cse222', choices)[0].label, 'CSE 2221');
  assert.equal(searchChoices('cse2221', choices)[0].label, 'CSE 2221');
  assert.equal(searchChoices('paol buc', choices)[0].label, 'Paolo Bucci');
  assert.equal(searchChoices('softwrae', choices)[0].kind, 'course');
  assert.equal(searchChoices('ngueyn', choices)[0].label, 'Lisa Nguyen');
});

test('exact spelling outranks fuzzy suggestions and results are bounded', () => {
  assert.ok(searchScore('Paolo Bucci', 'Paolo Bucci') > searchScore('Paolo Bucci', 'Paulo Bucci'));
  assert.equal(searchChoices('cse', choices, 1).length, 1);
  assert.deepEqual(searchChoices('', choices), []);
  assert.equal(normalizeSearch('  José  García '), 'jose garcia');
});

test('a selected professor keeps only that instructor’s sections in mixed API results', () => {
  const days = ['monday'];
  const result = filterInstructorCourses([
    entry('GENED', '4001', 'Reflection', [taught(1, days, '9:00', '10:00', ['Alisa Paulsen']), taught(2, days, '9:00', '10:00', ['Lisa Nguyen'])]),
    entry('ENGLISH', '1110', 'Composition', [taught(3, days, '9:00', '10:00', ['Lisa D Pinkerton'])]),
  ], 'Lisa Nguyen');
  assert.deepEqual(result.primary.map((e) => e.sections.map((s) => s.classNumber)), [[2]]);
  assert.deepEqual(result.related, []);
  assert.equal(instructorMatches('Alisa Nguyen', 'Lisa Nguyen'), false);
  assert.equal(instructorMatches('Lisa Marie Nguyen', 'Lisa Nguyen'), true);
});
