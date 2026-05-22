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
	assert.equal(AVAILABILITY_BASE, 'https://archive.org/wayback/available');
});

test('buildSaveUrl appends the target URL verbatim', () => {
	assert.equal(buildSaveUrl('https://old.reddit.com/r/x'), 'https://web.archive.org/save/https://old.reddit.com/r/x');
	assert.equal(buildSaveUrl(''), 'https://web.archive.org/save/');
});

test('buildAvailabilityUrl uses the documented `url` query param', () => {
	const out = buildAvailabilityUrl('https://example.com/page');
	assert.match(out, /^https:\/\/archive\.org\/wayback\/available\?/);
	assert.match(out, /url=https/);
});

test('parseAvailabilityResponse extracts the closest snapshot', () => {
	const ok = parseAvailabilityResponse({
		archived_snapshots: {
			closest: {
				url: 'https://web.archive.org/web/20230101000000/https://example.com',
				timestamp: '20230101000000',
				available: true,
			},
		},
	});
	assert.equal(ok.url, 'https://web.archive.org/web/20230101000000/https://example.com');
	assert.equal(ok.timestamp, '20230101000000');
	assert.equal(ok.available, true);
});

test('parseAvailabilityResponse returns null when there is no closest snapshot', () => {
	assert.equal(parseAvailabilityResponse({}), null);
	assert.equal(parseAvailabilityResponse({ archived_snapshots: {} }), null);
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
