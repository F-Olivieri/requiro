import assert from 'node:assert/strict';
import {fileSlug, formatDate, formatDateTime} from './ui/format.js';

process.env.TZ = 'America/Los_Angeles';
const stored = '2026-11-11T00:41:05+00:00';
assert.equal(formatDate(stored), new Date(stored).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}));
assert.ok(formatDate(stored).includes('10') && !formatDate(stored).includes('11,'), 'A late-evening local save keeps its local calendar day.');
assert.ok(formatDateTime(stored).includes('41') && !formatDateTime(stored).includes('T00'), 'Times are readable and local.');
for (const value of [null, undefined, '', 'not a date']) {
  assert.equal(formatDate(value), '');
  assert.equal(formatDateTime(value), '');
}
assert.equal(fileSlug('Shared garden task board v3', 'PRD-1'), 'shared-garden-task-board-v3');
assert.equal(fileSlug('Café / Ölweg: Plan!', 'PRD-1'), 'cafe-olweg-plan');
assert.equal(fileSlug('读书清单', 'PRD-1'), 'PRD-1');
assert.ok(fileSlug('a '.repeat(200), 'PRD-1').length <= 80);
console.log('Format passed: local readable dates, empty fallbacks and ASCII filename slugs.');
