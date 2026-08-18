import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';
import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom();

const cs = await loadFlowModule('lib/utils/commentShredder.js', 'comment-shredder');
const { summariseOutcome } = cs;
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

// The outcome summary. A run makes hundreds of writes at 1-2/s and reddit 429s
// hard, so "overwrite landed, delete failed" is the likely failure — not the
// exotic one. The previous version shared one try block between the two calls and
// reported that state as "left alone", which is the opposite of the truth: the
// original text is permanently gone and the comment is still publicly visible.
test('a comment that was overwritten but not deleted is never described as untouched', () => {
	const message = summariseOutcome({ overwritten: 1, deleted: 0, stranded: 1, untouched: 0 });

	assert.ok(!/left alone/i.test(message), `must not claim an overwritten comment was left alone: ${message}`);
	assert.ok(!/untouched|unchanged/i.test(message), `must not claim an overwritten comment is unchanged: ${message}`);
	assert.match(message, /original text is gone/i, 'must say the content is destroyed');
	assert.match(message, /still visible/i, 'must say the comment is still public');
	assert.match(message, /run again/i, 'must tell the user how to finish the job');
});

test('the two failure modes are reported separately and never conflated', () => {
	const message = summariseOutcome({ overwritten: 3, deleted: 2, stranded: 1, untouched: 4 });

	assert.match(message, /Overwrote 3, deleted 2\./);
	assert.match(message, /\b1\b[^.]*overwritten but could not be deleted/i, 'the stranded count is reported on its own');
	assert.match(message, /\b4\b[^.]*could not be overwritten/i, 'the genuinely untouched count is reported on its own');
});

test('a clean run says nothing alarming', () => {
	const message = summariseOutcome({ overwritten: 10, deleted: 10, stranded: 0, untouched: 0 });

	assert.equal(message, 'Overwrote 10, deleted 10. Reload the page to see the result.');
});

test('singular and plural agree, because this message is read under stress', () => {
	assert.match(summariseOutcome({ overwritten: 1, deleted: 0, stranded: 1, untouched: 0 }), /1 was overwritten but could not be deleted/);
	assert.match(summariseOutcome({ overwritten: 2, deleted: 0, stranded: 2, untouched: 0 }), /2 were overwritten but could not be deleted/);
	assert.match(summariseOutcome({ overwritten: 0, deleted: 0, stranded: 0, untouched: 1 }), /1 could not be overwritten and was left unchanged/);
	assert.match(summariseOutcome({ overwritten: 0, deleted: 0, stranded: 0, untouched: 2 }), /2 could not be overwritten and were left unchanged/);
});

// The module must route through the helper rather than rebuilding the sentence,
// and must not share a try block between the overwrite and the delete again.
test('execute tracks stranded and untouched as distinct outcomes', () => {
	const source = codeOnly(readRepoFile('lib/modules/commentShredder.js'));

	assert.ok(source.includes('summariseOutcome('), 'the module should use the shared summary helper');
	assert.match(source, /stranded\+\+/, 'a failed delete after a successful overwrite must be counted as stranded');
	assert.match(source, /untouched\+\+/, 'a failed overwrite must be counted separately');
	assert.ok(!/failed\+\+/.test(source), 'the old single failure counter should be gone');
});

// --- stop and progress, executed ------------------------------------------
//
// The regex above proves the counters are written; it cannot prove that pressing
// Stop actually stops anything, nor that it stops in the right *place*. A stop
// that landed between a comment's overwrite and its delete would manufacture the
// stranded state — content destroyed, comment still visible — which is the exact
// failure the two-try split exists to report rather than cause.

const Shredder = await loadModule('lib/modules/commentShredder.js', 'comment-shredder-exec');

// The module is `include: ['profile']` and its options are read directly off the
// module object, so the registry copy is the one to configure.
const shredderModule = Shredder.__registry.getUnchecked('commentShredder');

// A limiter that runs immediately: the rate limiting is tested elsewhere and here
// it would only make the test slow.
const passthroughLimiter = { schedule: fn => fn() };

const fakeSelected = n => Array.from({ length: n }, (unused, i) => ({ item: { fullname: `t1_c${i}` } }));

function recordRequests() {
	const calls = [];
	globalThis.__fetchHook = (url, init) => {
		calls.push(String(url));
		return Promise.resolve(new Response('{"json":{"errors":[]}}', {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));
	};
	return calls;
}

function controls({ stopAfter = Infinity } = {}) {
	const progress = [];
	let finished = null;
	return {
		progress,
		get finished() { return finished; },
		onProgress(n) { progress.push(n); },
		shouldStop: () => progress.length >= stopAfter,
		finish(message) { finished = message; },
	};
}

test('Stop before the first comment sends nothing at all', async () => {
	const calls = recordRequests();
	const c = controls({ stopAfter: 0 });

	await Shredder.execute(fakeSelected(5), 'modhash', passthroughLimiter, c);

	assert.deepEqual(calls, [], 'a stop requested before the loop must not destroy anything');
	assert.match(c.finished, /^Stopped\./, 'the panel must say it stopped, not report a completed run');
	assert.match(c.finished, /5 were not attempted/, 'silence about the remainder reads as "there was nothing left"');

	globalThis.__fetchHook = null;
});

test('Stop lands between comments, never between a comment\'s overwrite and its delete', async () => {
	const calls = recordRequests();
	// deleteAfterOverwrite is the default, but assert it rather than assume — with
	// it off, this test would pass while proving nothing about the pairing.
	assert.equal(shredderModule.options.deleteAfterOverwrite.value, true);

	const c = controls({ stopAfter: 1 });
	await Shredder.execute(fakeSelected(5), 'modhash', passthroughLimiter, c);

	assert.equal(calls.length, 2, `exactly one comment should have been processed, saw ${calls.join(', ')}`);
	assert.match(calls[0], /editusertext/, 'the overwrite must come first');
	assert.match(calls[1], /\/api\/del/, 'and its delete must still happen — stopping in between strands the comment');

	assert.match(c.finished, /Overwrote 1, deleted 1\./);
	assert.match(c.finished, /4 were not attempted/);

	globalThis.__fetchHook = null;
});

test('progress is reported per comment, before the work rather than after', async () => {
	recordRequests();
	const c = controls();

	await Shredder.execute(fakeSelected(3), 'modhash', passthroughLimiter, c);

	assert.deepEqual(c.progress, [1, 2, 3], 'the count must advance during the run, not once at the end');
	assert.ok(!/Stopped/.test(c.finished), 'a run that was never stopped must not claim it was');
	assert.match(c.finished, /Overwrote 3, deleted 3\./);

	globalThis.__fetchHook = null;
});

test('a stopped run and a completed run do not read the same', () => {
	const counts = { overwritten: 2, deleted: 2, stranded: 0, untouched: 0 };

	const completed = summariseOutcome(counts);
	const halted = summariseOutcome({ ...counts, stopped: true, remaining: 98 });

	assert.notEqual(completed, halted);
	assert.ok(!/Stopped/.test(completed));
	assert.match(halted, /Stopped\./);
	assert.match(halted, /98 were not attempted/);
	// A stop with nothing left is a finished run in all but name; it must not
	// claim a remainder it does not have.
	assert.ok(!/not attempted/.test(summariseOutcome({ ...counts, stopped: true, remaining: 0 })));
});

test('the panel shows a live count and a working Stop button', () => {
	let captured = null;
	const panel = Shredder.confirmPanel(3, c => { captured = c; });
	document.body.append(panel);

	const input = panel.querySelector('input[type="text"]');
	const buttons = Array.from(panel.querySelectorAll('button'));
	const shred = buttons.find(b => b.textContent === 'Shred');
	const stop = buttons.find(b => b.textContent === 'Stop');

	assert.ok(shred && stop, 'the panel must offer both a start and a stop');
	assert.equal(shred.disabled, true, 'the destructive button must start disabled');
	assert.equal(stop.hidden, true, 'Stop is meaningless before a run starts');

	// The typed confirmation still gates the start.
	input.value = 'delete';
	input.dispatchEvent(new window.Event('input'));
	assert.equal(shred.disabled, true, 'the confirmation is case-sensitive on purpose');
	input.value = 'DELETE';
	input.dispatchEvent(new window.Event('input'));
	assert.equal(shred.disabled, false);

	shred.click();
	assert.ok(captured, 'confirming must hand the run its controls');
	assert.equal(stop.hidden, false, 'Stop must appear for the duration of the run');

	const status = panel.querySelector('[role="status"]');
	assert.ok(status && !status.hidden, 'a minutes-long irreversible run needs a visible status line');
	assert.match(status.textContent, /0 of 3/);

	captured.onProgress(2);
	assert.match(status.textContent, /2 of 3/, 'the count must advance as the run proceeds');

	assert.equal(captured.shouldStop(), false);
	stop.click();
	assert.equal(captured.shouldStop(), true, 'pressing Stop must be what the loop reads');

	captured.finish('Stopped. Overwrote 2, deleted 2.');
	assert.equal(stop.hidden, true, 'Stop must not linger after the run ends');
	assert.match(status.textContent, /Stopped\./, 'the outcome belongs in the panel the user is looking at');

	panel.remove();
});

// --- the panel's own survival ------------------------------------------------
//
// `execute` is only half the story. The Stop button and the progress line live
// in a notification that closes on a timer, and the run they control can outlast
// it: the default cap is 100 comments at one request a second, and `maxPerRun`
// is free text against a listing that reaches 1000. A run that outlives its
// panel keeps deleting with no way to stop it and nothing reporting how far it
// has got.

function panelInNotification(count, onConfirm) {
	const host = document.createElement('div');
	host.className = 'RESNotification';
	const panel = Shredder.confirmPanel(count, onConfirm);
	host.append(panel);
	document.body.append(host);

	const resets = [];
	host.addEventListener('notification-reset', () => resets.push(Date.now()));

	return {
		host,
		panel,
		resets,
		go: panel.querySelector('button'),
		status: panel.querySelector('p[role="status"]'),
		confirm: panel.querySelector('input[type="text"]'),
		start() {
			this.confirm.value = 'DELETE';
			this.confirm.dispatchEvent(new Event('input', { bubbles: true }));
			this.go.click();
		},
	};
}

test('a running shred keeps its own panel from closing underneath it', async () => {
	let captured;
	const ui = panelInNotification(3, controls => { captured = controls; });
	ui.start();
	assert.ok(captured, 'confirming should hand back the run controls');

	assert.deepEqual(ui.resets, [], 'nothing to keep alive before the first comment');
	captured.onProgress(1);
	captured.onProgress(2);
	assert.equal(ui.resets.length, 2, 'every progress tick must restart the notification close timer');
	assert.match(ui.status.textContent, /2 of 3/);

	// Release the in-flight lock: it is module state, and the next test asserts
	// on it.
	captured.finish('Overwrote 3, deleted 3.');
	ui.host.remove();
});

test('a run that throws reports it rather than stranding the panel on "Shredding"', async () => {
	let captured;
	const ui = panelInNotification(2, controls => { captured = controls; });
	ui.start();

	assert.equal(ui.go.textContent, 'Shredding…');
	captured.fail('network went away');

	assert.equal(ui.go.textContent, 'Failed', 'a stranded "Shredding…" is indistinguishable from a hung run');
	assert.match(ui.status.textContent, /may have finished part of the work/, 'a partial destructive run must say so');
	assert.match(ui.status.textContent, /network went away/);

	ui.host.remove();
});

test('the call site actually routes a thrown run into that failure path', () => {
	// The panel can only report a throw if someone catches it. Before this the
	// call was fire-and-forget, so the rejection went nowhere.
	assert.match(mod, /execute\(plan\.selected, uh, limiter, controls\)\.catch\(/);
	assert.match(mod, /controls\.fail\(String\(\(e && e\.message\) \|\| e\)\)/);
});

test('a second shred cannot start while one is still running', async () => {
	let first;
	const one = panelInNotification(3, controls => { first = controls; });
	one.start();
	assert.ok(first);

	// A fresh panel, as the link builds on every use.
	let second = null;
	const two = panelInNotification(3, controls => { second = controls; });
	two.start();

	assert.equal(second, null, 'the second run must not be handed controls');
	assert.match(two.status.textContent, /already going in this tab/);

	// And it becomes possible again once the first finishes.
	first.finish('Overwrote 3, deleted 3.');
	let third = null;
	const three = panelInNotification(1, controls => { third = controls; });
	three.start();
	assert.ok(third, 'a run must be startable again after the previous one ends');
	third.finish('done');

	one.host.remove();
	two.host.remove();
	three.host.remove();
});
