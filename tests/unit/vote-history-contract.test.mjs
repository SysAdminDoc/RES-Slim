import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-vote-history');
fs.mkdirSync(tmpDir, { recursive: true });
const strip = file => flowRemoveTypes(fs.readFileSync(path.join(repoRoot, file), 'utf8'), { all: true }).toString();
// voteHistory imports ./csv; emit it alongside so the relative import resolves.
fs.writeFileSync(path.join(tmpDir, 'csv.mjs'), strip('lib/utils/csv.js'));
const stripped = strip('lib/utils/voteHistory.js').replace(/from '\.\/csv'/, "from './csv.mjs'");
const modulePath = path.join(tmpDir, 'voteHistory.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	SCHEMA_VERSION,
	DB_NAME,
	STORE_NAME,
	makeId,
	classifyDirection,
	buildRecord,
	filterRecords,
	toCsv,
} = await import(pathToFileURL(modulePath).href);

test('constants are stable and documented', () => {
	assert.equal(SCHEMA_VERSION, 1);
	assert.equal(DB_NAME, 'rsm-voteHistory');
	assert.equal(STORE_NAME, 'votes');
});

test('classifyDirection maps the documented value space', () => {
	assert.equal(classifyDirection(1), 'up');
	assert.equal(classifyDirection('1'), 'up');
	assert.equal(classifyDirection('up'), 'up');
	assert.equal(classifyDirection(-1), 'down');
	assert.equal(classifyDirection('down'), 'down');
	assert.equal(classifyDirection(0), 'unvote');
	assert.equal(classifyDirection(null), 'unvote');
	assert.equal(classifyDirection('bogus'), null);
});

test('makeId composes fullname + timestamp', () => {
	assert.equal(makeId('t1_abc', 1700000000123), 't1_abc@1700000000123');
});

test('buildRecord normalises kind from fullname prefix', () => {
	const post = buildRecord({ fullname: 't3_abc', direction: 'up', subreddit: 'pics', author: 'a', permalink: '/p/', body: 'hi', scoreAtTime: 5, now: 100 });
	assert.equal(post.kind, 't3');
	const comment = buildRecord({ fullname: 't1_def', direction: 'down', subreddit: '', author: '', permalink: '', body: '', scoreAtTime: 0, now: 100 });
	assert.equal(comment.kind, 't1');
	assert.equal(buildRecord({ fullname: 'bogus', direction: 'up', subreddit: '', author: '', permalink: '', body: '', scoreAtTime: 0 }), null);
	assert.equal(buildRecord({ fullname: '', direction: 'up', subreddit: '', author: '', permalink: '', body: '', scoreAtTime: 0 }), null);
});

test('buildRecord clamps snippet to 240 chars and collapses whitespace', () => {
	const long = 'x'.repeat(500);
	const rec = buildRecord({ fullname: 't1_abc', direction: 'up', subreddit: 's', author: 'a', permalink: '/p/', body: `${long}\n\nmore`, scoreAtTime: 0, now: 1 });
	assert.equal(rec.snippet.length, 240);
});

test('filterRecords filters by subreddit / author / direction / time window', () => {
	const a = { id: '1', fullname: 't1_a', kind: 't1', direction: 'up', subreddit: 'Pics', author: 'alice', permalink: '', snippet: '', scoreAtTime: 0, timestamp: 100 };
	const b = { id: '2', fullname: 't1_b', kind: 't1', direction: 'down', subreddit: 'news', author: 'bob', permalink: '', snippet: '', scoreAtTime: 0, timestamp: 200 };
	const all = [a, b];
	assert.deepEqual(filterRecords(all, { subreddit: 'pics' }).map(r => r.id), ['1']);
	assert.deepEqual(filterRecords(all, { direction: 'down' }).map(r => r.id), ['2']);
	assert.deepEqual(filterRecords(all, { since: 150 }).map(r => r.id), ['2']);
	assert.deepEqual(filterRecords(all, { author: 'BOB' }).map(r => r.id), ['2']);
});

test('toCsv quotes values that contain commas, quotes, or newlines', () => {
	const csv = toCsv([
		{ id: '1', fullname: 't1_a', kind: 't1', direction: 'up', subreddit: 's', author: 'a', permalink: '/p/', snippet: 'hello, "world"', scoreAtTime: 1, timestamp: 1700000000000 },
	]);
	const lines = csv.split('\n');
	assert.match(lines[0], /^timestamp,direction,fullname/);
	assert.match(lines[1], /"hello, ""world"""/);
});

test('toCsv neutralizes spreadsheet formula injection but keeps negative numbers', () => {
	const csv = toCsv([
		{ id: '1', fullname: 't1_a', kind: 't1', direction: 'up', subreddit: 's', author: '=HYPERLINK("http://evil")', permalink: '/p/', snippet: '@SUM(1+1)', scoreAtTime: -5, timestamp: 1700000000000 },
	]);
	const cells = csv.split('\n')[1].split(',');
	// author (index 5) formula-prefixed with a leading apostrophe
	assert.ok(cells[5].startsWith(`"'=HYPERLINK`) || cells[5].startsWith(`'=HYPERLINK`), cells[5]);
	// scoreAtTime (index 7) preserved as a plain negative number
	assert.equal(cells[7], '-5');
});

test('voteHistory module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as voteHistory \} from '\.\/voteHistory';/);
	assert.match(index, /^\s*voteHistory,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/voteHistory.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/voteHistory'/);
	assert.match(mod, /indexedDB\.open\(/);
	assert.match(mod, /watchForThings\(\['post', 'comment'\]/);
	for (const opt of ['recordVotes', 'maxRecords', 'snippetLength']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
