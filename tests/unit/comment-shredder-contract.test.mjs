import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const cs = await loadFlowModule('lib/utils/commentShredder.js', 'comment-shredder');
const mod = readRepoFile('lib/modules/commentShredder.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

function item(overrides = {}) {
	return {
		fullname: 't1_abc',
		subreddit: 'AskHistorians',
		body: 'a comment',
		score: 3,
		createdUtc: (NOW - 800 * DAY) / 1000,
		...overrides,
	};
}

function options(overrides = {}) {
	return {
		olderThanDays: 365,
		subredditMode: 'deny',
		subreddits: [],
		keepScoreAtOrAbove: null,
		keepGilded: true,
		maxPerRun: 100,
		...overrides,
	};
}

test('an empty allow list selects nothing, not everything', () => {
	// This inversion is the failure mode that makes the ecosystem scripts
	// dangerous: a half-configured filter that reads as "no restrictions".
	const decision = cs.shouldShred(item(), options({ subredditMode: 'allow', subreddits: [] }), NOW);
	assert.equal(decision.shred, false);
	assert.match(decision.reason, /allow list/);

	const plan = cs.planShred([item(), item({ fullname: 't1_def' })], options({ subredditMode: 'allow', subreddits: [] }), NOW);
	assert.equal(plan.selected.length, 0);
	assert.equal(plan.skipped.length, 2);
});

test('an allow list selects only the listed subreddits', () => {
	const opts = options({ subredditMode: 'allow', subreddits: ['askhistorians'] });
	assert.equal(cs.shouldShred(item({ subreddit: 'AskHistorians' }), opts, NOW).shred, true);
	assert.equal(cs.shouldShred(item({ subreddit: 'aww' }), opts, NOW).shred, false);
});

test('a deny list keeps the listed subreddits and shreds the rest', () => {
	const opts = options({ subredditMode: 'deny', subreddits: ['aww'] });
	assert.equal(cs.shouldShred(item({ subreddit: 'aww' }), opts, NOW).shred, false);
	assert.equal(cs.shouldShred(item({ subreddit: 'AWW' }), opts, NOW).shred, false, 'case must not defeat the keep list');
	assert.equal(cs.shouldShred(item({ subreddit: 'programming' }), opts, NOW).shred, true);
});

test('age is a floor, not a ceiling', () => {
	const opts = options({ olderThanDays: 365 });
	assert.equal(cs.shouldShred(item({ createdUtc: (NOW - 400 * DAY) / 1000 }), opts, NOW).shred, true);
	assert.equal(cs.shouldShred(item({ createdUtc: (NOW - 10 * DAY) / 1000 }), opts, NOW).shred, false);
	// Exactly at the boundary counts as old enough.
	assert.equal(cs.shouldShred(item({ createdUtc: (NOW - 365 * DAY) / 1000 }), opts, NOW).shred, true);
});

test('archived, stickied and awarded comments are skipped', () => {
	// Reddit answers an edit on an archived comment with a 200 and an error
	// payload, so a run that ignores them reports success having changed nothing.
	assert.match(cs.shouldShred(item({ archived: true }), options(), NOW).reason, /archived/);
	assert.match(cs.shouldShred(item({ stickied: true }), options(), NOW).reason, /stickied/);
	assert.match(cs.shouldShred(item({ gilded: true }), options({ keepGilded: true }), NOW).reason, /gilded/);
	assert.equal(cs.shouldShred(item({ gilded: true }), options({ keepGilded: false }), NOW).shred, true);
});

test('the score threshold keeps comments at or above it', () => {
	const opts = options({ keepScoreAtOrAbove: 50 });
	assert.equal(cs.shouldShred(item({ score: 50 }), opts, NOW).shred, false);
	assert.equal(cs.shouldShred(item({ score: 49 }), opts, NOW).shred, true);
	// A null threshold must not be read as zero, which would keep everything.
	assert.equal(cs.shouldShred(item({ score: 0 }), options({ keepScoreAtOrAbove: null }), NOW).shred, true);
	assert.equal(cs.shouldShred(item({ score: -8 }), options({ keepScoreAtOrAbove: 0 }), NOW).shred, true);
});

test('the per-run cap moves the overflow into skipped rather than dropping it', () => {
	const items = Array.from({ length: 10 }, (_, i) => item({ fullname: `t1_${i}` }));
	const plan = cs.planShred(items, options({ maxPerRun: 3 }), NOW);
	assert.equal(plan.selected.length, 3);
	assert.equal(plan.cappedAt, 3);
	// Every input is still accounted for — a silent truncation reads as
	// "everything matched" in the preview.
	assert.equal(plan.selected.length + plan.skipped.length, 10);
	assert.ok(plan.skipped.every(d => d.shred === false));
	assert.match(plan.skipped[0].reason, /cap/);
});

test('every skip carries a reason so the preview can explain itself', () => {
	const items = [
		item({ fullname: 't1_1', archived: true }),
		item({ fullname: 't1_2', createdUtc: NOW / 1000 }),
		item({ fullname: 't1_3' }),
	];
	const plan = cs.planShred(items, options(), NOW);
	assert.equal(plan.selected.length, 1);
	for (const decision of plan.skipped) {
		assert.equal(typeof decision.reason, 'string');
		assert.ok(decision.reason.length > 0);
	}
});

test('parseSubredditList normalises what people actually type', () => {
	assert.deepEqual(cs.parseSubredditList('r/AskHistorians, /r/aww  programming'), ['askhistorians', 'aww', 'programming']);
	assert.deepEqual(cs.parseSubredditList(''), []);
	assert.deepEqual(cs.parseSubredditList(null), []);
});

test('overwriteBody never repeats itself between comments', () => {
	// Reddit silently drops an edit whose body matches the previous one, so a
	// constant overwrite string leaves the second pass a no-op.
	const bodies = new Set();
	for (let i = 0; i < 50; i++) bodies.add(cs.overwriteBody('', i));
	assert.ok(bodies.size > 40, `only ${bodies.size} distinct bodies in 50`);

	// And it must never be empty — reddit rejects an empty edit.
	for (const body of bodies) assert.ok(body.trim().length > 0);
});

test('a user template still varies per comment', () => {
	assert.equal(cs.overwriteBody('gone {n}', 7), 'gone 7');
	const a = cs.overwriteBody('nothing to see here', 1);
	const b = cs.overwriteBody('nothing to see here', 2);
	assert.notEqual(a, b);
	assert.match(a, /nothing to see here/);
});

test('parseListing maps reddit fields and ignores posts', () => {
	const json = {
		data: {
			after: 't1_zzz',
			children: [
				{ kind: 't1', data: { name: 't1_a', subreddit: 'aww', body: 'hi', score: 12, created_utc: 1700000000, archived: false } },
				{ kind: 't3', data: { name: 't3_b', subreddit: 'aww', title: 'a post' } },
				{ kind: 't1', data: { name: 't1_c', subreddit: 'pics', body: 'x', score: 1, created_utc: 1700000001, all_awardings: [{}] } },
			],
		},
	};
	const { items, after } = cs.parseListing(json);
	assert.equal(after, 't1_zzz');
	assert.equal(items.length, 2, 'a t3 post must never enter a comment shredder run');
	assert.equal(items[0].fullname, 't1_a');
	assert.equal(items[0].score, 12);
	assert.equal(items[1].gilded, true, 'an award should count as gilded');
});

test('parseListing survives a malformed response', () => {
	assert.deepEqual(cs.parseListing(null), { items: [], after: null });
	assert.deepEqual(cs.parseListing({}), { items: [], after: null });
	assert.deepEqual(cs.parseListing({ data: { children: [null, {}] } }), { items: [], after: null });
});

test('the module is off, preview-first, and asks before deleting', () => {
	assert.match(mod, /module\.disabledByDefault = true/);
	// dryRun must default to true.
	assert.match(mod, /dryRun: \{[\s\S]{0,120}value: true/);
	// The typed confirmation, not a bare button.
	assert.match(mod, /input\.value\.trim\(\) !== 'DELETE'/);
	// Overwrite must precede delete, or the text survives in every archive.
	const editAt = mod.indexOf('/api/editusertext');
	const delAt = mod.indexOf('/api/del');
	assert.ok(editAt > 0 && delAt > editAt, 'editusertext must be issued before del');
	// Writes are rate-limited and the run is scoped to your own profile.
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /me\.toLowerCase\(\) !== profile\.toLowerCase\(\)/);
});

test('the module never uses a blocking dialog', () => {
	assert.doesNotMatch(mod, /\bwindow\.confirm\(|\balert\(/);
});
