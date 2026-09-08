import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';
import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom();

// `subredditBlacklist` is where the careful subreddit-name normaliser lives; the
// shredder reuses it so the destructive feature and the hide-only one agree on
// what a keep-list entry means.
const cs = await loadFlowModule('lib/utils/commentShredder.js', 'comment-shredder', { deps: ['lib/utils/subredditBlacklist.js'] });
const { summariseOutcome } = cs;
const { SHRED_LEASE_HEARTBEAT_MS } = await loadFlowModule('lib/utils/shredLease.js', 'shred-lease-heartbeat', { deps: ['lib/utils/userTags.js'] });
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
	assert.match(message, /\b1\b[^.]*overwritten but couldn't be deleted/i, 'the stranded count is reported on its own');
	assert.match(message, /\b4\b[^.]*could not be overwritten/i, 'the genuinely untouched count is reported on its own');
});

test('a clean run says nothing alarming', () => {
	const message = summariseOutcome({ overwritten: 10, deleted: 10, stranded: 0, untouched: 0 });

	assert.equal(message, 'Overwrote 10, deleted 10. Reload the page to see the result.');
});

test('singular and plural agree, because this message is read under stress', () => {
	assert.match(summariseOutcome({ overwritten: 1, deleted: 0, stranded: 1, untouched: 0 }), /1 was overwritten but couldn't be deleted/);
	assert.match(summariseOutcome({ overwritten: 2, deleted: 0, stranded: 2, untouched: 0 }), /2 were overwritten but couldn't be deleted/);
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


// The panel now takes a lease, because a tab-local boolean cannot see the tab
// that matters. These stand in for the background authority.
function grantingLease() {
	const calls = [];
	return {
		calls,
		acquire() { calls.push('acquire'); return Promise.resolve({ ok: true, token: 'token-1' }); },
		renew(state) { calls.push(`renew:${state}`); return Promise.resolve(true); },
		release() { calls.push('release'); return Promise.resolve(); },
	};
}

// Grants once, then reports the account lost on every renew. The run is expected
// to notice and stop itself.
function losingLease() {
	const calls = [];
	return {
		calls,
		acquire() { calls.push('acquire'); return Promise.resolve({ ok: true, token: 'token-1' }); },
		renew(state) { calls.push(`renew:${state}`); return Promise.resolve(false); },
		release() { calls.push('release'); return Promise.resolve(); },
	};
}

function refusingLease(owner = { sameTab: false, state: 'running', runningForMs: 65000 }) {
	const calls = [];
	return {
		calls,
		acquire() { calls.push('acquire'); return Promise.resolve({ ok: false, owner }); },
		renew() { calls.push('renew'); return Promise.resolve(false); },
		release() { calls.push('release'); return Promise.resolve(); },
	};
}

// Starting is asynchronous now: the panel asks the background whether anyone
// else is running before it hands over the controls.
// `confirmPanel` takes the selected decisions rather than a count, because it
// writes them down before the run starts. These fixtures only ever cared about
// the length, so this builds a plan of the right size.
function planOf(count) {
	return Array.from({ length: count }, (_, index) => ({
		item: {
			fullname: `t1_fixture${index}`,
			subreddit: 'fixture',
			body: `body ${index}`,
			score: 1,
			createdUtc: 1700000000,
			permalink: `/r/fixture/comments/a/b/c${index}/`,
		},
		shred: true,
		reason: 'matched',
	}));
}

// A lease that does not answer until the test says so. The window between the
// click and the background's answer is where the panel is most exposed, and it
// cannot be reached with a lease that resolves immediately.
function deferredLease() {
	const calls = [];
	let grant;
	return {
		calls,
		acquire() { calls.push('acquire'); return new Promise(resolve => { grant = resolve; }); },
		answer(value = { ok: true, token: 'token-1' }) { grant(value); },
		renew(state) { calls.push(`renew:${state}`); return Promise.resolve(true); },
		release() { calls.push('release'); return Promise.resolve(); },
	};
}

function settle() {
	return new Promise(resolve => { setTimeout(resolve, 0); });
}

test('the panel shows a live count and a working Stop button', async () => {
	let captured = null;
	const lease = grantingLease();
	const panel = Shredder.confirmPanel(planOf(3), c => { captured = c; }, lease);
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
	await settle();
	assert.ok(captured, 'confirming must hand the run its controls');
	assert.deepEqual(lease.calls, ['acquire'], 'the run must take the account lease before it starts');
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
	await settle();
	assert.ok(lease.calls.includes('release'), 'a finished run must hand the account back rather than wait out the TTL');
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

function panelInNotification(count, onConfirm, lease = grantingLease()) {
	const host = document.createElement('div');
	host.className = 'RESNotification';
	const panel = Shredder.confirmPanel(planOf(count), onConfirm, lease);
	host.append(panel);
	document.body.append(host);

	const resets = [];
	host.addEventListener('notification-reset', () => resets.push(Date.now()));

	return {
		host,
		panel,
		lease,
		resets,
		go: panel.querySelector('button'),
		status: panel.querySelector('p[role="status"]'),
		confirm: panel.querySelector('input[type="text"]'),
		async start() {
			this.confirm.value = 'DELETE';
			this.confirm.dispatchEvent(new Event('input', { bubbles: true }));
			this.go.click();
			await settle();
		},
	};
}

test('a running shred keeps its own panel from closing underneath it', async () => {
	let captured;
	const ui = panelInNotification(3, controls => { captured = controls; });
	await ui.start();
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
	await ui.start();

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


test('a run refused by another tab is reported and stays retryable', async () => {
	// The case the tab-local boolean could never see: a second tab, or the other
	// renderer, already deleting for this account.
	let handed = null;
	const lease = refusingLease({ sameTab: false, state: 'running', runningForMs: 65000 });
	const ui = panelInNotification(3, controls => { handed = controls; }, lease);
	await ui.start();

	assert.equal(handed, null, 'a refused run must never be handed the controls');
	assert.match(ui.status.textContent, /another tab/, 'the user has to be told where the other run is');
	assert.match(ui.status.textContent, /1m 5s/, 'and how long it has been going, so waiting is an informed choice');
	assert.equal(ui.go.disabled, false, 'a refusal is temporary, so the button has to stay usable');
	assert.deepEqual(lease.calls, ['acquire'], 'a refused run must not renew or release a lease it never held');

	// The confirmation still gates the retry rather than being spent by it.
	ui.confirm.value = 'no';
	ui.confirm.dispatchEvent(new Event('input', { bubbles: true }));
	assert.equal(ui.go.disabled, true);

	ui.host.remove();
});

test('a failed run hands the account back', async () => {
	let handed = null;
	const lease = grantingLease();
	const ui = panelInNotification(3, controls => { handed = controls; }, lease);
	await ui.start();
	assert.ok(handed);

	handed.fail('network died');
	await settle();
	assert.ok(lease.calls.includes('release'), 'a crashed run must not hold the account until the TTL expires');

	ui.host.remove();
});

test('losing the account mid-run stops the run rather than deleting alongside another tab', async () => {
	// The failure this guards against is two tabs issuing edit and delete requests
	// for one account at the same time. A run that loses its lease and carries on
	// is that state, and the run that noticed is the only thing that can end it.
	let handed = null;
	const lease = losingLease();
	const ui = panelInNotification(3, controls => { handed = controls; }, lease);
	await ui.start();
	assert.ok(handed);
	assert.equal(handed.shouldStop(), false, 'nothing has gone wrong yet');

	// One heartbeat.
	await new Promise(resolve => { setTimeout(resolve, SHRED_LEASE_HEARTBEAT_MS + 50); });

	assert.ok(lease.calls.some(c => c.startsWith('renew')), 'the run has to be renewing at all');
	assert.equal(handed.shouldStop(), true, 'a lost account must stop the loop the same way the Stop button does');

	// And the outcome says why, rather than reporting a stop the user did not ask for.
	handed.finish('Overwrote 1, deleted 1.');
	await settle();
	assert.match(ui.status.textContent, /another tab took over/i);

	ui.host.remove();
});

test('typing in the confirmation box during the lease check cannot start a second run', async () => {
	// The button is re-enabled on every `input` event. During the await for the
	// background's answer that let a second click through, and its refusal — which
	// lands after the first run has begun — overwrote the live progress line and
	// handed the button back mid-run.
	let handed = 0;
	let controls = null;
	let resolveAcquire = null;
	const slowLease = {
		calls: [],
		acquire() {
			slowLease.calls.push('acquire');
			return new Promise(resolve => { resolveAcquire = resolve; });
		},
		renew() { return Promise.resolve(true); },
		release() { return Promise.resolve(); },
	};

	const ui = panelInNotification(3, c => { handed += 1; controls = c; }, slowLease);
	ui.confirm.value = 'DELETE';
	ui.confirm.dispatchEvent(new Event('input', { bubbles: true }));
	ui.go.click();
	await settle();

	assert.equal(ui.go.disabled, true, 'the button must stay disabled while the answer is outstanding');
	// The event that used to re-enable it.
	ui.confirm.dispatchEvent(new Event('input', { bubbles: true }));
	assert.equal(ui.go.disabled, true, 'typing must not re-arm a start that is already in flight');

	ui.go.click();
	await settle();
	assert.deepEqual(slowLease.calls, ['acquire'], 'a second click must not ask for the account again');

	resolveAcquire({ ok: true, token: 'token-1' });
	await settle();
	assert.equal(handed, 1, 'exactly one run may be handed the controls');
	assert.equal(ui.go.disabled, true, 'the button stays disabled for the duration of the run');
	assert.match(ui.status.textContent, /0 of 3/, 'the live progress line must survive');

	// Ends the run, which clears the heartbeat. A live interval outlives the test
	// and holds the whole file open with no subtest to point at.
	controls.finish('done');
	await settle();
	ui.host.remove();
});

test('a second shred cannot start while one is still running', async () => {
	let first;
	const one = panelInNotification(3, controls => { first = controls; });
	await one.start();
	assert.ok(first);

	// A fresh panel, as the link builds on every use.
	let second = null;
	const two = panelInNotification(3, controls => { second = controls; });
	await two.start();

	assert.equal(second, null, 'the second run must not be handed controls');
	assert.match(two.status.textContent, /already going in this tab/);
	assert.deepEqual(two.lease.calls, [], 'the tab-local guard must answer without troubling the background');

	// And it becomes possible again once the first finishes.
	first.finish('Overwrote 3, deleted 3.');
	await settle();
	let third = null;
	const three = panelInNotification(1, controls => { third = controls; });
	await three.start();
	assert.ok(third, 'a run must be startable again after the previous one ends');
	third.finish('done');

	one.host.remove();
	two.host.remove();
	three.host.remove();
});

test('a keep-list entry written as a URL or with a trailing slash still protects', () => {
	// The old parser only stripped a leading `/r/`, so `r/pics/` became `pics/`
	// and a pasted URL stayed a URL. Neither matches the bare name `shouldShred`
	// compares against, so in the default keep-list mode every comment in a
	// subreddit the reader had explicitly protected was selected for
	// overwrite-and-delete.
	const spellings = [
		'pics',
		'r/pics',
		'/r/pics',
		'r/pics/',
		'/r/pics/',
		'R/PICS',
		'https://old.reddit.com/r/pics',
		'https://www.reddit.com/r/pics/',
	];

	for (const spelling of spellings) {
		assert.deepEqual(cs.parseSubredditList(spelling), ['pics'], `${spelling} should name r/pics`);
	}

	// And the decision that matters: with any of those on the keep list, a
	// comment in r/pics survives.
	const item = {
		fullname: 't1_a',
		subreddit: 'pics',
		body: 'x',
		score: 0,
		createdUtc: 1_600_000_000,
		archived: false,
		stickied: false,
	};
	const now = 1_700_000_000_000;
	for (const spelling of spellings) {
		const decision = cs.shouldShred(item, {
			olderThanDays: 1,
			subredditMode: 'deny',
			subreddits: cs.parseSubredditList(spelling),
			keepScoreAtOrAbove: null,
			keepGilded: false,
			maxPerRun: 100,
		}, now);
		assert.equal(decision.shred, false, `${spelling} should protect r/pics`);
		assert.match(decision.reason, /keep list/);
	}
});

test('an entry that is not a subreddit name is reported rather than dropped', () => {
	// Silently dropping these is what made the defect above invisible: the list
	// looked accepted and one line of it protected nothing.
	// The field splits on whitespace as well as commas, which its own description
	// promises, so each word is its own entry. `not` and `name` are perfectly
	// good subreddit names; `a` is too short and `name!` has a character reddit
	// does not allow.
	assert.deepEqual(cs.unreadableSubredditEntries('pics, not a name!, aww'), ['a', 'name!']);
	assert.deepEqual(cs.unreadableSubredditEntries('pics r/aww'), []);
	assert.deepEqual(cs.unreadableSubredditEntries(''), []);
	assert.deepEqual(cs.unreadableSubredditEntries(null), []);

	// A name too long to be a subreddit is refused rather than truncated.
	assert.deepEqual(cs.unreadableSubredditEntries('a'.repeat(22)), ['a'.repeat(22)]);
});

// The copy taken before the run, which is the only thing standing between a
// reader and an irreversible mistake.
//
// The dry run says what will go and the typed word makes them say it out loud;
// neither keeps anything. reddit stores no history of an edited comment, so once
// the body is replaced the original is gone from every copy the reader can
// reach.

const ARCHIVE_PLAN = [
	{
		item: {
			fullname: 't1_aaa',
			subreddit: 'pics',
			body: 'first body\nsecond line',
			score: 42,
			createdUtc: 1_700_000_000,
			permalink: '/r/pics/comments/x/y/aaa/',
		},
		shred: true,
		reason: 'matched',
	},
	{
		item: {
			fullname: 't1_bbb',
			// A comment that is itself a heading. Archived as a quote, or it
			// restructures the document it lands in.
			body: '# not a heading in the archive',
			subreddit: 'aww',
			score: -3,
			createdUtc: 1_700_000_600,
		},
		shred: true,
		reason: 'matched',
	},
];

// The download is watched at the seam the helper actually uses -- it creates an
// object URL, points an attached anchor at it and clicks -- rather than through
// a stub of the helper itself. Watching the real path is the difference between
// asserting the archive is written and asserting a function was called.
// `failFrom` is which write starts failing (1 fails both, 2 lets the first
// through), so a half-written archive is reachable -- the case where a file is
// on disk and the run has stopped.
function watchDownloads(events, { fail = false, failFrom = 1 } = {}) {
	const realCreate = URL.createObjectURL;
	const realRevoke = URL.revokeObjectURL;
	const blobs = [];
	let attempts = 0;
	URL.createObjectURL = blob => {
		attempts += 1;
		if (fail && attempts >= failFrom) throw new Error('no object URL available');
		events.push('download');
		blobs.push(blob);
		return `blob:fixture-${blobs.length}`;
	};
	URL.revokeObjectURL = () => {};
	// Anything an earlier test left behind on its 1.5-second removal timer, so the
	// names read back are this test's.
	for (const anchor of document.querySelectorAll('a[download]')) anchor.remove();
	return {
		blobs,
		names: () => [...document.querySelectorAll('a[download]')].map(anchor => anchor.download),
		restore() {
			URL.createObjectURL = realCreate;
			URL.revokeObjectURL = realRevoke;
			for (const anchor of document.querySelectorAll('a[download]')) anchor.remove();
		},
	};
}

test('the archive carries every selected comment, with what reddit will not give back', () => {
	const archive = cs.buildShredArchive(ARCHIVE_PLAN, 'someone', Date.UTC(2026, 8, 8, 12, 0, 0));

	assert.equal(archive.count, ARCHIVE_PLAN.length);
	assert.equal(archive.comments.length, ARCHIVE_PLAN.length, 'every selected comment has to be in it');
	assert.equal(archive.account, 'someone');
	assert.match(archive.savedAt, /^2026-09-08T/);

	const [first] = archive.comments;
	assert.equal(first.body, 'first body\nsecond line', 'the body is the whole point');
	assert.equal(first.score, 42);
	// The permalink is the field reddit will not hand back once the comment is
	// gone, which makes it the one worth keeping most.
	assert.equal(first.permalink, 'https://old.reddit.com/r/pics/comments/x/y/aaa/');
	assert.equal(first.createdAt, new Date(1_700_000_000 * 1000).toISOString());

	// A comment with no permalink is still archived, without one.
	assert.equal(archive.comments[1].permalink, '');
});

test('both formats round-trip what they claim to', () => {
	const archive = cs.buildShredArchive(ARCHIVE_PLAN, 'someone', Date.UTC(2026, 8, 8));

	const parsed = JSON.parse(cs.shredArchiveJson(archive));
	assert.deepEqual(parsed, archive, 'the JSON has to be the archive, not a rendering of it');

	const markdown = cs.shredArchiveMarkdown(archive);
	assert.match(markdown, /# Comments shredded from \/u\/someone/);
	assert.match(markdown, /r\/pics/);
	assert.match(markdown, /> first body/);
	assert.match(markdown, /> second line/, 'a multi-line body stays quoted on every line');
	// The comment that is a heading must not become one.
	assert.match(markdown, /> # not a heading in the archive/);
	assert.ok(!/^# not a heading/m.test(markdown), 'a comment cannot restructure the archive around it');
});

test('the filenames say whose comments they are and when', () => {
	const names = cs.shredArchiveFilenames('some_one', Date.UTC(2026, 8, 8));
	assert.equal(names.json, 'res-slim-shred-some_one-2026-09-08.json');
	assert.equal(names.markdown, 'res-slim-shred-some_one-2026-09-08.md');

	// A name that cannot go in a filename does not produce one that is unsafe.
	const awkward = cs.shredArchiveFilenames('../../etc/passwd', Date.UTC(2026, 8, 8));
	assert.ok(!awkward.json.includes('/'), `a path separator reached the filename: ${awkward.json}`);
	assert.ok(!awkward.json.includes('..'), `a traversal reached the filename: ${awkward.json}`);
});

test('the copy is written before anything is destroyed, and both formats go out', async () => {
	// The ordering is the feature. An archive written after the first overwrite is
	// an archive of something that has already gone.
	const events = [];
	const downloads = watchDownloads(events);

	const lease = grantingLease();
	const panel = Shredder.confirmPanel(ARCHIVE_PLAN, controls => {
		events.push('run');
		// Ends the run, so the module-wide in-flight flag is down for the next test.
		controls.finish('done');
	}, lease, 'someone');
	document.body.append(panel);

	const archiveBox = panel.querySelector('input[type="checkbox"]');
	assert.ok(archiveBox, 'the panel has to offer the archive');
	assert.equal(archiveBox.checked, true, 'and offer it on by default');

	try {
		const input = panel.querySelector('input[type="text"]');
		input.value = 'DELETE';
		input.dispatchEvent(new Event('input'));
		panel.querySelector('button').click();
		await settle();
		await settle();

		assert.deepEqual(events, ['download', 'download', 'run'], `the copy has to be written first: ${events.join(', ')}`);

		const names = downloads.names();
		assert.ok(names.some(name => name.endsWith('.json')), `no JSON file: ${names.join(', ')}`);
		assert.ok(names.some(name => name.endsWith('.md')), `no Markdown file: ${names.join(', ')}`);
		assert.ok(names.every(name => name.includes('someone')), 'the files should say whose comments they are');

		// The entry count is the plan's, not a subset.
		const json = JSON.parse(await downloads.blobs[0].text());
		assert.equal(json.comments.length, ARCHIVE_PLAN.length);
		assert.equal(json.comments[0].body, ['first body', 'second line'].join('\n'));
	} finally {
		downloads.restore();
		panel.remove();
	}
});

test('a copy that cannot be written stops the run rather than shredding without it', async () => {
	const events = [];
	const downloads = watchDownloads(events, { fail: true });

	const lease = grantingLease();
	const panel = Shredder.confirmPanel(ARCHIVE_PLAN, () => { events.push('run'); }, lease, 'someone');
	document.body.append(panel);

	try {
		const input = panel.querySelector('input[type="text"]');
		input.value = 'DELETE';
		input.dispatchEvent(new Event('input'));
		panel.querySelector('button').click();
		await settle();
		await settle();

		assert.deepEqual(events, [], 'nothing may be destroyed when the copy could not be saved');
		const status = panel.querySelector('[role="status"]');
		assert.match(status.textContent, /nothing was changed/i, 'and the reader has to be told why');
	} finally {
		downloads.restore();
		panel.remove();
	}
});

test('turning the copy off asks for the confirmation word again', async () => {
	// Shredding without a copy is a different decision from shredding with one,
	// and it is the more dangerous of the two.
	const events = [];
	const downloads = watchDownloads(events);

	const lease = grantingLease();
	const panel = Shredder.confirmPanel(ARCHIVE_PLAN, controls => {
		events.push('run');
		controls.finish('done');
	}, lease, 'someone');
	document.body.append(panel);

	try {
		const input = panel.querySelector('input[type="text"]');
		const archiveBox = panel.querySelector('input[type="checkbox"]');
		const shred = panel.querySelector('button');

		input.value = 'DELETE';
		input.dispatchEvent(new Event('input'));
		assert.equal(shred.disabled, false, 'the word alone arms it while the copy is on');

		archiveBox.checked = false;
		archiveBox.dispatchEvent(new Event('change'));
		assert.equal(input.value, '', 'the typed word is cleared');
		assert.equal(shred.disabled, true, 'and the button goes back to disabled');

		// Said again, it runs, and writes nothing.
		input.value = 'DELETE';
		input.dispatchEvent(new Event('input'));
		shred.click();
		await settle();
		await settle();
		assert.deepEqual(events, ['run'], `no copy should be written with the box off: ${events.join(', ')}`);
	} finally {
		downloads.restore();
		panel.remove();
	}
});

test('unticking the copy after the click cannot take it away', async () => {
	// The lease is answered by the background, which on an MV3 cold start is
	// easily hundreds of milliseconds away. The box used to be read after that
	// await and stayed clickable throughout, so a reader who clicked Shred and then
	// changed their mind about the copy got neither the copy nor a second ask for
	// the confirmation word: the most destructive path in the extension, reachable
	// with a click and a tick.
	const events = [];
	const downloads = watchDownloads(events);
	const lease = deferredLease();
	const panel = Shredder.confirmPanel(ARCHIVE_PLAN, controls => {
		events.push('run');
		controls.finish('done');
	}, lease, 'someone');
	document.body.append(panel);

	try {
		const input = panel.querySelector('input[type="text"]');
		const archiveBox = panel.querySelector('input[type="checkbox"]');
		input.value = 'DELETE';
		input.dispatchEvent(new Event('input'));
		panel.querySelector('button').click();
		await settle();

		// Mid-flight, the box is not the reader's to change any more.
		assert.equal(archiveBox.disabled, true, 'the copy can still be switched off while the lease is pending');
		archiveBox.checked = false;
		archiveBox.dispatchEvent(new Event('change'));

		lease.answer();
		await settle();
		await settle();

		assert.deepEqual(events, ['download', 'download', 'run'],
			`the copy the reader confirmed has to be written: ${events.join(', ')}`);
	} finally {
		downloads.restore();
		panel.remove();
	}
});

test('a copy that only half writes says so, and still destroys nothing', async () => {
	// Both files are rendered before either is handed over, so this is the narrow
	// case where the first write lands and the second does not. The reader has a
	// file on disk; telling them nothing was saved sends them looking for one that
	// is already there.
	const events = [];
	const downloads = watchDownloads(events, { fail: true, failFrom: 2 });
	const lease = grantingLease();
	const panel = Shredder.confirmPanel(ARCHIVE_PLAN, () => { events.push('run'); }, lease, 'someone');
	document.body.append(panel);

	try {
		const input = panel.querySelector('input[type="text"]');
		input.value = 'DELETE';
		input.dispatchEvent(new Event('input'));
		panel.querySelector('button').click();
		await settle();
		await settle();

		assert.deepEqual(events, ['download'], 'nothing may be destroyed when the copy is incomplete');
		const status = panel.querySelector('[role="status"]');
		assert.match(status.textContent, /nothing was changed/i);
		assert.match(status.textContent, /\.json could be saved/i, `the reader is not told which file was written: ${status.textContent}`);
		assert.ok(!/\.md could be saved/i.test(status.textContent), 'a file that was not written is named as one that was');
		assert.equal(lease.calls.includes('release'), true, 'the lease has to go back');
	} finally {
		downloads.restore();
		panel.remove();
	}
});

test('the filenames and the timestamp inside the file come from one clock', () => {
	// Two reads of the clock disagree across a UTC midnight, which puts one date on
	// the file and a different one inside it.
	const source = codeOnly(readRepoFile('lib/modules/commentShredder.js'));
	const block = source.slice(source.indexOf('if (wantsArchive)'), source.indexOf('runInFlight = true;'));
	assert.ok(block.includes('buildShredArchive'), 'the archive block was not found where it was looked for');
	assert.equal((block.match(/Date\.now\(\)/g) || []).length, 1, 'the archive block reads the clock more than once');
});

// Every other field in this panel falls back in the safe direction. An
// unreadable "older than" becomes a year, an unreadable cap becomes a hundred.
// The keep-score fell back to `null`, and `null` there means "no score
// threshold" -- so typing something the parser could not read made the selection
// *wider*, on the one screen in this extension that deletes things, and nothing
// said the number had been discarded.

test('a keep-score that is not a number is not a missing keep-score', () => {
	for (const typed of ['fifty', '50 or so', 'e5', '5.5', '-', '  ', ' 12 ', '-3', '+7', '', null, undefined]) {
		const reads = cs.unreadableKeepScore(typed);
		const shouldRead = typed === null || typed === undefined || String(typed).trim() === '' || /^[+-]?\d+$/.test(String(typed).trim());
		if (shouldRead) assert.equal(reads, null, `"${String(typed)}" should have been readable`);
		else assert.equal(reads, String(typed).trim(), `"${String(typed)}" was accepted`);
	}
});

test('an unreadable keep-score selects nothing at all', () => {
	// Not "selects everything with no threshold", which is what a silent fallback
	// to null does. A question the reader has to answer is not the same as an
	// answer of "no limit".
	const items = [
		{ id: 't1_a', subreddit: 'pics', score: 900, body: 'x', createdUtc: 1_600_000_000 },
		{ id: 't1_b', subreddit: 'pics', score: -4, body: 'y', createdUtc: 1_600_000_000 },
	];
	const base = {
		olderThanDays: 1,
		subredditMode: 'deny',
		subreddits: [],
		keepScoreAtOrAbove: null,
		keepGilded: false,
		maxPerRun: 100,
	};
	const now = 1_700_000_000_000;

	// With no threshold at all, both go.
	const open = cs.planShred(items, base, now);
	assert.equal(open.selected.length, 2, 'the fixture does not select anything, so this proves nothing');

	// With one that could not be read, neither does.
	const blocked = cs.planShred(items, { ...base, keepScoreUnreadable: 'fifty' }, now);
	assert.equal(blocked.selected.length, 0, 'an unreadable threshold still let comments through');
	assert.equal(blocked.skipped.length, 2);
	for (const decision of blocked.skipped) {
		assert.match(decision.reason, /keep-score value "fifty" could not be read/);
	}

	// And a readable one still works, including a negative and a zero.
	assert.equal(cs.planShred(items, { ...base, keepScoreAtOrAbove: 0 }, now).selected.length, 1);
	assert.equal(cs.planShred(items, { ...base, keepScoreAtOrAbove: -10 }, now).selected.length, 0);
});

test('the panel says the number was discarded, above everything else', () => {
	// Every other line in that panel describes the plan, and with nothing selected
	// they all read as "there is nothing to shred" -- which is the opposite of what
	// happened.
	const source = codeOnly(readRepoFile('lib/modules/commentShredder.js'));
	const summary = source.slice(source.indexOf('function summarise('), source.indexOf('export function confirmPanel'));

	const scoreAt = summary.indexOf('unreadableKeepScore(');
	const subsAt = summary.indexOf('unreadableSubredditEntries(');
	assert.ok(scoreAt > -1, 'the panel never mentions an unreadable keep-score');
	assert.ok(subsAt > -1);
	assert.ok(scoreAt < subsAt, 'the keep-score warning is below the subreddit one');
	assert.match(summary, /could not be read, so no comments were selected/);

	// And the option is read through the helper rather than parsed a second time
	// somewhere else, which is how the two would drift.
	const options = source.slice(source.indexOf('function shredOptions('), source.indexOf('function summarise('));
	assert.match(options, /keepScoreUnreadable: unreadableKeepScore\(stored\)/);
	// Read once, from the same place the numeric parse reads. `|| ''` used to turn
	// a numeric 0 into "no threshold", which widens a destructive selection with
	// nothing said -- a typed "0" is the string and was safe; a 0 arriving from a
	// settings import was not.
	assert.match(options, /const stored = module\.options\.keepScoreAtOrAbove\.value;/);
	assert.match(options, /String\(stored === null \|\| stored === undefined \? '' : stored\)/);
	// `|| ''` in either spelling is the bug: it makes a numeric 0 mean "no
	// threshold" rather than "keep anything at or above zero".
	assert.ok(!/stored \|\| ''/.test(options), 'a numeric zero is still discarded');
	assert.ok(!/keepScoreAtOrAbove\.value \|\| ''/.test(options), 'a numeric zero is still discarded');
});
