import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-per-sub-sort');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/perSubSort.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'perSubSort.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parseSubListingPath,
	buildSortedPath,
	shouldRedirect,
	normalizePreference,
	SUPPORTED_SORTS,
	SUPPORTED_TIME_WINDOWS,
} = await import(pathToFileURL(modulePath).href);

test('SUPPORTED_SORTS and SUPPORTED_TIME_WINDOWS cover the canonical old.reddit set', () => {
	for (const s of ['hot', 'new', 'rising', 'top', 'controversial', 'best']) {
		assert.ok(SUPPORTED_SORTS.includes(s), `expected sort ${s}`);
	}
	for (const t of ['hour', 'day', 'week', 'month', 'year', 'all']) {
		assert.ok(SUPPORTED_TIME_WINDOWS.includes(t), `expected window ${t}`);
	}
});

test('parseSubListingPath extracts sub + sort + t', () => {
	assert.deepEqual(parseSubListingPath('/r/pics/'), { sub: 'pics', sort: null, t: null });
	assert.deepEqual(parseSubListingPath('/r/pics/top/', '?t=year'), { sub: 'pics', sort: 'top', t: 'year' });
	assert.deepEqual(parseSubListingPath('/r/pics/new'), { sub: 'pics', sort: 'new', t: null });
	assert.deepEqual(parseSubListingPath('/r/PICS/'), { sub: 'pics', sort: null, t: null });
});

test('parseSubListingPath returns null sub for non-subreddit URLs', () => {
	assert.deepEqual(parseSubListingPath('/'), { sub: null, sort: null, t: null });
	assert.deepEqual(parseSubListingPath('/comments/abc'), { sub: null, sort: null, t: null });
	assert.deepEqual(parseSubListingPath('/user/alice'), { sub: null, sort: null, t: null });
	assert.deepEqual(parseSubListingPath(null), { sub: null, sort: null, t: null });
});

test('parseSubListingPath ignores unknown segments and t values', () => {
	assert.deepEqual(parseSubListingPath('/r/pics/bogus/'), { sub: 'pics', sort: null, t: null });
	assert.deepEqual(parseSubListingPath('/r/pics/top/', '?t=eternity'), { sub: 'pics', sort: 'top', t: null });
});

test('buildSortedPath serialises sort and appends t for top/controversial', () => {
	assert.equal(buildSortedPath('pics', { sort: 'new' }), '/r/pics/new/');
	assert.equal(buildSortedPath('pics', { sort: 'top', t: 'year' }), '/r/pics/top/?t=year');
	assert.equal(buildSortedPath('pics', { sort: 'controversial', t: 'all' }), '/r/pics/controversial/?t=all');
	assert.equal(buildSortedPath('pics', { sort: 'new', t: 'year' }), '/r/pics/new/', 't is dropped for sorts that ignore it');
	assert.equal(buildSortedPath('', { sort: 'top' }), '/');
});

test('shouldRedirect fires only on bare sub URLs with a stored preference', () => {
	const pref = { sort: 'top', t: 'all' };
	assert.equal(shouldRedirect({ sub: 'pics', sort: null, t: null }, pref), true);
	assert.equal(shouldRedirect({ sub: 'pics', sort: 'new', t: null }, pref), false);
	assert.equal(shouldRedirect({ sub: null, sort: null, t: null }, pref), false);
	assert.equal(shouldRedirect({ sub: 'pics', sort: null, t: null }, null), false);
});

test('normalizePreference drops unknown sort + unrequired t', () => {
	assert.deepEqual(normalizePreference({ sort: 'new' }), { sort: 'new' });
	assert.deepEqual(normalizePreference({ sort: 'new', t: 'week' }), { sort: 'new' });
	assert.deepEqual(normalizePreference({ sort: 'top', t: 'week' }), { sort: 'top', t: 'week' });
	assert.deepEqual(normalizePreference({ sort: 'top', t: 'eternity' }), { sort: 'top' });
	assert.equal(normalizePreference({ sort: 'bogus' }), null);
	assert.equal(normalizePreference(null), null);
});

test('perSubSort module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as perSubSort \} from '\.\/perSubSort';/);
	assert.match(index, /^\s*perSubSort,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/perSubSort.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/perSubSort'/);
	assert.match(mod, /Storage\.wrapFeatureBlob\('perSubSort', 'RESmodules\.perSubSort\.prefs'/);
	for (const opt of ['redirectOnEntry', 'showSaveButton']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('perSubSort SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_perSubSort.scss');
	assert.ok(fs.existsSync(scssPath));
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@use 'modules\/perSubSort'/);
});
