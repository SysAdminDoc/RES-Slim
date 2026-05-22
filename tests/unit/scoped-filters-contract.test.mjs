import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-scoped-filters');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/scopedFilters.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'scopedFilters.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parsePerSubMutes,
	muteApplies,
	parseUrlSubstrings,
	urlMatchesAny,
} = await import(pathToFileURL(modulePath).href);

test('parsePerSubMutes accepts user|sub, user@sub, prefixes', () => {
	const list = parsePerSubMutes('spammer|news, /u/badbot|/r/pics\nfoo@bar');
	assert.deepEqual(list, [
		{ user: 'spammer', sub: 'news' },
		{ user: 'badbot', sub: 'pics' },
		{ user: 'foo', sub: 'bar' },
	]);
});

test('parsePerSubMutes dedupes and drops malformed entries', () => {
	const list = parsePerSubMutes('spammer|news, spammer|news, no-sub, |empty');
	assert.equal(list.length, 1);
	assert.deepEqual(list[0], { user: 'spammer', sub: 'news' });
});

test('muteApplies matches case-insensitively and supports * sub wildcard', () => {
	const mutes = [{ user: 'spammer', sub: 'news' }, { user: 'everywherebot', sub: '*' }];
	assert.equal(muteApplies(mutes, 'news', 'Spammer'), true);
	assert.equal(muteApplies(mutes, 'pics', 'spammer'), false);
	assert.equal(muteApplies(mutes, 'anywhere', 'everywherebot'), true);
	assert.equal(muteApplies(mutes, '', 'spammer'), false);
	assert.equal(muteApplies(mutes, 'news', ''), false);
});

test('parseUrlSubstrings lowercases, dedupes, drops empties', () => {
	assert.deepEqual(parseUrlSubstrings('Affiliate.com, ?ref=spam,affiliate.com\nfoo'), ['affiliate.com', '?ref=spam', 'foo']);
	assert.deepEqual(parseUrlSubstrings(''), []);
});

test('urlMatchesAny matches substring case-insensitively across multiple URLs', () => {
	const subs = ['?ref=spam', 'affiliate.example.com'];
	assert.equal(urlMatchesAny(['https://x/?REF=spam'], subs), true);
	assert.equal(urlMatchesAny(['https://affiliate.example.com/page'], subs), true);
	assert.equal(urlMatchesAny(['https://example.com'], subs), false);
	assert.equal(urlMatchesAny([], subs), false);
	assert.equal(urlMatchesAny(['https://x'], []), false);
});

test('scopedFilters module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as scopedFilters \} from '\.\/scopedFilters';/);
	assert.match(index, /^\s*scopedFilters,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/scopedFilters.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/scopedFilters'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	assert.match(mod, /watchForThings\(\['comment'\]/);
	for (const opt of ['perSubMutes', 'urlSubstrings', 'hideCompletely']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
