import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-author-context');
fs.mkdirSync(tmpDir, { recursive: true });
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/authorContext.js'), 'utf8');
const stripped = flowRemoveTypes(source, { all: true }).toString();
const modulePath = path.join(tmpDir, 'authorContext.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parseAuthorAbout,
	formatAccountAge,
	formatKarma,
	formatBadge,
	isFresh,
	ageRiskClass,
} = await import(pathToFileURL(modulePath).href);

const NOW = 2_000_000_000_000; // 2033-05-18

test('parseAuthorAbout normalises the legacy Reddit /about.json shape', () => {
	const raw = { kind: 't2', data: { name: 'alice', created_utc: 1_500_000_000, link_karma: 1234, comment_karma: 5678, total_karma: 6912, is_mod: true, is_gold: false, verified: true, has_verified_email: true } };
	const about = parseAuthorAbout(raw, NOW);
	assert.equal(about.username, 'alice');
	assert.equal(about.linkKarma, 1234);
	assert.equal(about.commentKarma, 5678);
	assert.equal(about.totalKarma, 6912);
	assert.equal(about.isMod, true);
	assert.equal(about.verified, true);
	assert.equal(about.fetchedAt, NOW);
});

test('parseAuthorAbout accepts the unwrapped data shape too', () => {
	const flat = { name: 'bob', created_utc: 1000, link_karma: 10, comment_karma: 20 };
	const about = parseAuthorAbout(flat, NOW);
	assert.equal(about.username, 'bob');
	assert.equal(about.totalKarma, 30, 'total falls back to link + comment when total_karma is missing');
});

test('parseAuthorAbout returns null on malformed input', () => {
	assert.equal(parseAuthorAbout(null), null);
	assert.equal(parseAuthorAbout({}), null);
	assert.equal(parseAuthorAbout({ data: {} }), null, 'missing name is rejected');
});

test('formatAccountAge buckets into d / mo / y', () => {
	const day = 60 * 60 * 24;
	assert.equal(formatAccountAge(NOW / 1000 - day * 0.5, NOW), '<1d');
	assert.equal(formatAccountAge(NOW / 1000 - day * 12, NOW), '12d');
	assert.equal(formatAccountAge(NOW / 1000 - day * 90, NOW), '3mo');
	assert.equal(formatAccountAge(NOW / 1000 - day * 365 * 2 - day * 60, NOW), '2y2mo');
	assert.equal(formatAccountAge(NOW / 1000 - day * 365 * 5, NOW), '5y');
	assert.equal(formatAccountAge(0, NOW), '?');
});

test('formatKarma uses k/m abbreviations with smart precision', () => {
	assert.equal(formatKarma(0), '0');
	assert.equal(formatKarma(999), '999');
	assert.equal(formatKarma(1500), '1.5k');
	assert.equal(formatKarma(12500), '12.5k');
	assert.equal(formatKarma(120_000), '120k');
	assert.equal(formatKarma(1_500_000), '1.5m');
	assert.equal(formatKarma(120_000_000), '120m');
	assert.equal(formatKarma(-1500), '-1.5k');
});

test('formatBadge concatenates age + karma when both enabled', () => {
	const day = 60 * 60 * 24;
	const about = { username: 'alice', createdUtc: NOW / 1000 - day * 365 * 3, linkKarma: 5000, commentKarma: 7000, totalKarma: 12000, isMod: false, isGold: false, verified: false, hasVerifiedEmail: false, fetchedAt: NOW };
	assert.equal(formatBadge(about, { showAge: true, showKarma: true }, NOW), '3y · 12k');
	assert.equal(formatBadge(about, { showAge: true, showKarma: false }, NOW), '3y');
	assert.equal(formatBadge(about, { showAge: false, showKarma: true }, NOW), '12k');
});

test('isFresh respects the TTL', () => {
	const about = { username: 'x', createdUtc: 0, linkKarma: 0, commentKarma: 0, totalKarma: 0, isMod: false, isGold: false, verified: false, hasVerifiedEmail: false, fetchedAt: NOW - 1000 };
	assert.equal(isFresh(about, 5000, NOW), true);
	assert.equal(isFresh(about, 500, NOW), false);
	assert.equal(isFresh(null, 5000, NOW), false);
});

test('ageRiskClass partitions <30d / <180d / mature', () => {
	const day = 60 * 60 * 24;
	assert.equal(ageRiskClass(NOW / 1000 - day * 10, NOW), 'new');
	assert.equal(ageRiskClass(NOW / 1000 - day * 100, NOW), 'young');
	assert.equal(ageRiskClass(NOW / 1000 - day * 365 * 5, NOW), 'mature');
	assert.equal(ageRiskClass(0, NOW), 'mature');
});

test('authorContextBadge module is registered and wires the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as authorContextBadge \} from '\.\/authorContextBadge';/);
	assert.match(index, /^\s*authorContextBadge,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/authorContextBadge.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/authorContext'/);
	assert.match(mod, /watchForThings\(\['post', 'comment'\]/);
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /\/user\/\$\{encodeURIComponent\(username\)\}\/about\.json/);
	for (const opt of ['showAge', 'showKarma', 'colorByAge', 'cacheHours', 'skipDeleted']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('authorContextBadge SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_authorContextBadge.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /\.rsm-authorBadge/);
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/authorContextBadge'/);
});
