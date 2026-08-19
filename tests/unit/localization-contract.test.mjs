// Date, time and number formatting moved from `dayjs` to the platform's `Intl`.
//
// dayjs was about 38KB in each of the foreground and options bundles, and it
// carried exactly ten compiled-in locales — so a user reading reddit in Japanese
// got English dates. `Intl` costs nothing and knows every locale the browser
// knows. These assert the behaviour that has to survive the swap, and the two
// places where `Intl` does not map onto dayjs one-for-one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/loadModule.mjs';
import { loadFlowModule, readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';

installDom();

// `locale` is the only thing this helper takes from the browser boundary, and it
// is a mutable binding — which the "follows the locale" assertion below depends
// on being able to change.
const ENVIRONMENT_STUB = 'export let locale = \'en-US\';\nexport function setLocale(value) { locale = value; }\n';
const L = await loadFlowModule('lib/utils/localization.js', 'localization', {
	stubs: { '../environment': ENVIRONMENT_STUB },
});
// The same stub instance the helper imports, so flipping the locale here is
// visible to it — that is the whole point of the mutable binding.
const { setLocale } = await import(new URL('./.tmp-localization/__stub-0.mjs', import.meta.url).href);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 2629746000;
const YEAR = 31556952000;

test('the coarsest unit that the difference actually fills is the one used', () => {
	const unit = ms => L.pickTimeUnit(ms).unit;
	assert.equal(unit(30 * SECOND), 'second');
	assert.equal(unit(90 * SECOND), 'minute');
	assert.equal(unit(30 * MINUTE), 'minute');
	assert.equal(unit(3 * HOUR), 'hour');
	assert.equal(unit(5 * DAY), 'day');
	assert.equal(unit(3 * MONTH), 'month');
	assert.equal(unit(2 * YEAR), 'year');

	assert.equal(L.pickTimeUnit(3 * HOUR).value, 3);
	assert.equal(L.pickTimeUnit(-3 * HOUR).value, -3, 'the sign carries the direction');
});

test('rounding never reports a value that belongs to the next unit up', () => {
	// 59.8 minutes does not fill an hour, so the unit is minutes — and then
	// rounding turns 59.8 into 60, which would render as "60 minutes ago".
	const promoted = L.pickTimeUnit(59.8 * MINUTE);
	assert.equal(promoted.unit, 'hour');
	assert.equal(promoted.value, 1);

	// The same at the other boundaries.
	assert.deepEqual(L.pickTimeUnit(23.9 * HOUR), { value: 1, unit: 'day' });
	assert.deepEqual(L.pickTimeUnit(59.9 * SECOND), { value: 1, unit: 'minute' });

	// And a value that genuinely belongs where it is stays there.
	assert.deepEqual(L.pickTimeUnit(45 * MINUTE), { value: 45, unit: 'minute' });
});

test('a relative time carries its direction, a duration does not', () => {
	// This is the one place Intl does not map onto dayjs one-for-one.
	// `dayjs().from(x, true)` suppresses the suffix; `Intl.RelativeTimeFormat`
	// always emits one, which is why `formatDateDiff` goes through
	// `Intl.NumberFormat`'s unit style instead.
	const threeHoursAgo = new Date(Date.now() - 3 * HOUR);

	const relative = L.formatRelativeTime(threeHoursAgo);
	assert.match(relative, /3/);
	assert.match(relative, /ago/i, 'a relative time without a direction is just a duration');

	const duration = L.formatDateDiff(threeHoursAgo);
	assert.match(duration, /3/);
	assert.doesNotMatch(duration, /ago|in /i, 'a bare duration must not claim a direction');
	assert.match(duration, /hour/i);
});

test('plurals come out right, which is the thing chrome.i18n could not express', () => {
	const now = Date.now();
	const diff = ms => L.formatDateDiff(new Date(now - ms), new Date(now));
	assert.match(diff(HOUR), /^1 hour$/);
	assert.match(diff(3 * HOUR), /^3 hours$/);
	assert.match(diff(DAY), /^1 day$/);
	assert.match(diff(5 * DAY), /^5 days$/);
});

test('numeric:auto is on, so a locale that has a word for it uses the word', () => {
	const yesterday = new Date(Date.now() - DAY);
	assert.match(L.formatRelativeTime(yesterday), /yesterday/i);
});

test('dates and numbers still format, and format through Intl', () => {
	const date = new Date('2026-08-19T14:30:45Z');
	const short = L.formatDate(date);
	const long = L.formatDateTime(date);

	assert.match(short, /\d/);
	assert.ok(long.length > short.length, 'the datetime form has to carry the time as well');
	assert.match(long, /45/, 'dayjs LTS carried seconds, so this has to as well');

	assert.equal(L.formatNumber(1234567), (1234567).toLocaleString());
	// Called with no argument, both date helpers mean "now" — dayjs(undefined)
	// did, and two callers rely on it.
	assert.match(L.formatDate(), /\d/);
	assert.match(L.formatDateTime(), /\d/);
});

test('dayjs is gone from the manifest and from lib', () => {
	const pkg = JSON.parse(readRepoFile('package.json'));
	assert.ok(!pkg.dependencies.dayjs, 'the dependency has to actually leave, or the bundle keeps it');
	assert.ok(!pkg.devDependencies.dayjs);

	// Both files explain in prose what they replaced, so the word is still in the
	// source. The assertion is about code. Paired with a check that the stripper
	// actually ran, because a stripper that silently no-ops turns this green.
	const raw = readRepoFile('lib/utils/localization.js');
	assert.match(raw, /dayjs/, 'the header should still say what this replaced');
	assert.doesNotMatch(codeOnly(raw), /dayjs/i);
	assert.doesNotMatch(codeOnly(readRepoFile('lib/modules/filteReddit/browseCases/Date.js')), /dayjs/i);
});

test('the formatter cache follows the locale rather than pinning the first one', () => {
	// `locale` is a mutable binding: it starts as navigator.language and is
	// replaced once reddit's own language preference arrives. The dayjs version
	// built its formatter with `once()`, so whichever locale happened to be
	// current at first use was the one it kept.
	const raw = readRepoFile('lib/utils/localization.js');
	const source = codeOnly(raw);
	assert.match(raw, /once\(\)/, 'the comment explaining the old behaviour should survive');
	assert.match(source, /builtFor !== locale/);
	assert.doesNotMatch(source, /\bonce\(/, 'once() is what pinned the wrong locale');
});

test('a locale change rebuilds the formatters instead of reusing the first', () => {
	// Executed rather than regexed: the stub exports a settable `locale`, which is
	// the same mutable-binding shape the real environment module has.
	const enUS = L.formatDate(new Date('2026-08-19T12:00:00Z'));
	setLocale('de-DE');
	const deDE = L.formatDate(new Date('2026-08-19T12:00:00Z'));
	setLocale('en-US');

	assert.notEqual(enUS, deDE, 'en-US writes the month first, de-DE writes the day first');
	assert.equal(L.formatDate(new Date('2026-08-19T12:00:00Z')), enUS, 'and switching back switches back');
});

test('Intl.DurationFormat is left undeclared on purpose', () => {
	// Chrome 129 / Firefox 136, against a floor of chrome 125 / firefox 130.
	// Leaving it out of the libdef makes reaching for it a type error here rather
	// than a blank timestamp on a browser we claim to support.
	const libdef = readRepoFile('flow/lib/intl.js.flow');
	assert.match(libdef, /RelativeTimeFormat: Class<Intl\$RelativeTimeFormat>/);
	assert.doesNotMatch(libdef, /DurationFormat: Class</);
	assert.doesNotMatch(readRepoFile('lib/utils/localization.js'), /new Intl\.DurationFormat/);
});
