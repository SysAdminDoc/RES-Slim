import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-wayback-snapshot');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/wayback.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'wayback.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	SAVE_BASE,
	AVAILABILITY_BASE,
	buildSaveUrl,
	buildAvailabilityUrl,
	parseAvailabilityResponse,
	isWaybackUrl,
	formatTimestamp,
} = await import(pathToFileURL(modulePath).href);

test('canonical bases are the documented endpoints', () => {
	assert.equal(SAVE_BASE, 'https://web.archive.org/save/');
	assert.equal(AVAILABILITY_BASE, 'https://web.archive.org/cdx/search/cdx');
});

test('buildSaveUrl appends the target URL verbatim', () => {
	assert.equal(buildSaveUrl('https://old.reddit.com/r/x'), 'https://web.archive.org/save/https://old.reddit.com/r/x');
	assert.equal(buildSaveUrl(''), 'https://web.archive.org/save/');
});

test('buildAvailabilityUrl requests the latest successful CDX capture', () => {
	const out = buildAvailabilityUrl('https://example.com/page');
	const url = new URL(out);
	assert.equal(url.origin + url.pathname, AVAILABILITY_BASE);
	assert.equal(url.searchParams.get('url'), 'https://example.com/page');
	assert.equal(url.searchParams.get('output'), 'json');
	assert.equal(url.searchParams.get('filter'), 'statuscode:200');
	assert.equal(url.searchParams.get('fl'), 'timestamp,original');
	assert.equal(url.searchParams.get('limit'), '-1');
});

test('parseAvailabilityResponse extracts the latest CDX snapshot', () => {
	const ok = parseAvailabilityResponse([
		['timestamp', 'original'],
		['20230101000000', 'https://example.com'],
	]);
	assert.equal(ok.url, 'https://web.archive.org/web/20230101000000/https://example.com');
	assert.equal(ok.timestamp, '20230101000000');
	assert.equal(ok.available, true);
});

test('parseAvailabilityResponse returns null when there is no closest snapshot', () => {
	assert.equal(parseAvailabilityResponse({}), null);
	assert.equal(parseAvailabilityResponse([['timestamp', 'original']]), null);
	assert.equal(parseAvailabilityResponse(null), null);
});

test('isWaybackUrl recognises web.archive.org/web/* only', () => {
	assert.equal(isWaybackUrl('https://web.archive.org/web/20230101/https://x.com'), true);
	assert.equal(isWaybackUrl('http://web.archive.org/web/abc'), true);
	assert.equal(isWaybackUrl('https://archive.org/wayback'), false);
	assert.equal(isWaybackUrl('https://example.com'), false);
});

test('formatTimestamp emits ISO-ish dates from Wayback 14-digit timestamps', () => {
	assert.equal(formatTimestamp('20230415120304'), '2023-04-15 12:03:04 UTC');
	assert.equal(formatTimestamp('not-a-ts'), 'not-a-ts');
	assert.equal(formatTimestamp(null), '');
});

test('waybackSnapshot module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as waybackSnapshot \} from '\.\/waybackSnapshot';/);
	assert.match(index, /^\s*waybackSnapshot,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/waybackSnapshot.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/wayback'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	assert.match(mod, /createRateLimiter\(/);
	for (const opt of ['mode', 'stalenessDays', 'target']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

// --- outage is not absence ---------------------------------------------------
//
// `checkAvailability` used to return `null` for every failure, so a 502, a
// dropped connection, a body the parser could not read and a genuine "this URL
// was never archived" were the same value — and the caller acted on the last
// reading, opening Save Page Now for a URL that may already be archived and
// then reporting "✓ checked".
//
// Observed live on 2026-08-18: archive.org answered 200 and the Wayback machine
// itself 302 while `/wayback/available` returned 502 for minutes.

const moduleSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/waybackSnapshot.js'), 'utf8');
// `classifyAvailability` lives in `lib/utils/wayback.js` alongside the other
// pure helpers, so it comes from the same stripped module as everything above —
// no slicing a function out of a file that reaches the whole extension.
const { classifyAvailability } = await import(pathToFileURL(modulePath).href);

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const YEAR = 365 * 24 * 60 * 60 * 1000;

function availableAt(timestamp) {
	return [['timestamp', 'original'], [timestamp, 'https://example.com']];
}

test('a fresh snapshot is reported as available', () => {
	const result = classifyAvailability(availableAt('20260810120000'), NOW, YEAR);
	assert.equal(result.state, 'available');
	assert.equal(result.isStale, false);
	assert.match(result.url, /^https:\/\/web\.archive\.org\/web\//);
});

test('an old snapshot is available but stale', () => {
	const result = classifyAvailability(availableAt('20200810120000'), NOW, YEAR);
	assert.equal(result.state, 'available');
	assert.equal(result.isStale, true, 'a six-year-old capture of a live page is worth refreshing');
});

test('a URL the API says is not archived is absent, not an outage', () => {
	assert.deepEqual(classifyAvailability([['timestamp', 'original']], NOW, YEAR), { state: 'absent' });
});

test('a response the parser cannot read is an outage, not an absence', () => {
	// The distinction that matters: "archive.org told us there is nothing" versus
	// "archive.org did not tell us anything". Reading the second as the first is
	// how a changed API shape becomes a silent wrong answer.
	for (const unreadable of [null, undefined, '', 'not json', 42, [], {}, [['timestamp', 'original'], ['bad', 'not a url']]]) {
		const result = classifyAvailability(unreadable, NOW, YEAR);
		assert.equal(result.state, 'unavailable', `${JSON.stringify(unreadable)} is not an answer`);
		assert.match(result.reason, /unreadable/);
	}
});

test('a transport failure is reported as unavailable, with its reason', () => {
	// The catch in checkAvailability is what turns a 502 or a dropped socket into
	// this shape; the shape itself is asserted here, and the wiring below.
	const stripped = moduleSource
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');

	assert.match(stripped, /catch \(e\) \{\s*\n\s*return \{ state: 'unavailable', reason: String\(\(e && e\.message\) \|\| e\) \};/);
	assert.ok(!/return null;/.test(stripped.slice(stripped.indexOf('async function checkAvailability'), stripped.indexOf('function openSave'))));
});

test('an unreachable API never triggers a save, and says so', () => {
	const stripped = moduleSource
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');
	const action = stripped.slice(stripped.indexOf('async function performAction'), stripped.indexOf('function injectButton'));

	// The whole point: an outage must not archive a page that may already have a
	// snapshot, on the strength of an answer that was never given.
	assert.match(action, /if \(avail\.state === 'unavailable'\) \{[\s\S]*?unreachable \+= 1;[\s\S]*?continue;/);
	const unavailableAt = action.indexOf("avail.state === 'unavailable'");
	const saveAt = action.indexOf('openSave(target)');
	assert.ok(unavailableAt > 0 && saveAt > unavailableAt, 'the outage branch has to come before the save');

	// And an absent snapshot still saves, which is the correct action for a URL
	// that genuinely is not archived.
	assert.match(action, /avail\.state === 'absent' \|\| avail\.isStale/);

	// The status line stops claiming success it did not have.
	assert.match(action, /archive\.org unreachable/);
	assert.match(action, /\$\{unreachable\} unreachable/);
});
