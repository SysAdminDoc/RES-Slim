// What the shadow-part machinery costs on a thread, and what stops it.
//
// Current Reddit puts a shadow root on every action row, award button and
// overflow menu below every comment. Each of those roots carries a subtree
// observer, and each observer used to re-run the entire install -- twenty-six
// selectors, several of them `:has()`, plus a thirteen-way sweep for nested
// hosts -- once per mutation batch. Reddit rerenders inside those roots on a
// hover, on an overflow menu opening and on every vote, so on a five-hundred
// comment thread the cost is not the selectors, it is how often they run.
//
// Three things bound it, and this file is about all three: the run is throttled
// to a frame, a root's selectors are cut down to the ones that can match its
// host, and a host that never grows a shadow root stops being asked.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadModule, installDom } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

installDom({ url: 'https://www.reddit.com/r/example/comments/x/y/', html: '<!doctype html><html><body><shreddit-app></shreddit-app></body></html>' });
const Shreddit = await loadModule('lib/utils/shreddit.js', 'shreddit-shadow-cost', { stubEnvironment: true });

function nextFrame() {
	return new Promise(resolve => {
		requestAnimationFrame(() => { setTimeout(resolve, 0); });
	});
}

// Counts the `querySelectorAll` calls made against one root, which is the unit
// of work the install is made of.
function countQueries(shadow) {
	const calls = [];
	const native = shadow.querySelectorAll.bind(shadow);
	shadow.querySelectorAll = selector => {
		calls.push(selector);
		return native(selector);
	};
	return calls;
}

test('an action row runs the selectors that can match it, not every selector there is', async () => {
	// The partition is by host, and the host is what a `::part()` rule in
	// `lib/css/` names. An action row cannot contain a post's share button, a
	// comment sort toolbar or a composer textarea, so it has no business asking.
	const action = document.createElement('shreddit-comment-action-row');
	action.attachShadow({ mode: 'open' }).innerHTML = `
		<span class="rpl-vote-button-group">
			<button upvote><svg icon-name="upvote"></svg></button>
			<faceplate-number>9</faceplate-number>
		</span>`;
	document.body.append(action);

	const calls = countQueries(action.shadowRoot);
	Shreddit.prepareShredditTree(action);
	await nextFrame();

	assert.ok(calls.length > 0, 'nothing ran at all, so this proves nothing');
	// Nine, against twenty-seven before: the vote group, its buttons, its score,
	// its icons, the award button and its icon, the overflow button and its icon,
	// and the one sweep for hosts nested inside this root.
	assert.ok(calls.length <= 10, `an action row asked ${calls.length} questions:\n${calls.join('\n')}`);

	// Matched whole, not by substring: `faceplate-textarea-input` is in the nested
	// host sweep and contains the word textarea, so a substring check here passes
	// or fails for the wrong reason.
	const foreign = [
		'#comment-sort-button',
		'textarea',
		'.reddit-search-bar',
		'shreddit-post-share-button',
		'.toolbar-container',
		'[data-action-bar-action]:not([data-action-bar-action="upvote"]):not([data-action-bar-action="downvote"])',
	];
	for (const selector of foreign) {
		assert.ok(!calls.includes(selector), `an action row asked for ${selector}`);
	}

	// And it still exposes what it is for.
	assert.match(action.shadowRoot.querySelector('[upvote]').getAttribute('part'), /\brsm-vote-button\b/);
	assert.match(action.shadowRoot.querySelector('faceplate-number').getAttribute('part'), /\brsm-vote-score\b/);
	action.remove();
});

test('every host a stylesheet paints is a host the partition still runs on', () => {
	// The safety net for the partition above. The part names exist to be reached
	// by a `<host>::part(name)` rule, so the stylesheets are the authority on
	// which hosts each rule has to run inside. Drop a host from a list in
	// `shreddit.js` and this fails naming it.
	const source = fs.readFileSync(path.join(repoRoot, 'lib', 'utils', 'shreddit.js'), 'utf8');
	const table = source.slice(source.indexOf('const SHREDDIT_PARTS = ['), source.indexOf('function addPart('));

	const allowed = new Map();
	for (const entry of table.split(/\n\t\{|\n\t\},/)) {
		const names = [...entry.matchAll(/'(rsm-[a-z-]+)'/g)].map(match => match[1]);
		if (!names.length) continue;
		const hostList = entry.match(/hosts: \[([^\]]*)\]/);
		const hosts = hostList ? [...hostList[1].matchAll(/'([a-z-]+)'/g)].map(match => match[1]) : null;
		for (const name of names) {
			if (!allowed.has(name)) allowed.set(name, hosts && new Set(hosts));
			else if (hosts && allowed.get(name)) for (const host of hosts) allowed.get(name).add(host);
			else allowed.set(name, null);
		}
	}
	// The share button's exportparts mapping is written outside the table.
	allowed.set('rsm-share-button', new Set(['shreddit-post']));
	allowed.set('rsm-share-icon', new Set(['shreddit-post']));

	const cssDir = path.join(repoRoot, 'lib', 'css');
	const files = [];
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.s?css$/.test(entry.name)) files.push(full);
		}
	};
	walk(cssDir);

	const pairs = [];
	for (const file of files) {
		const css = fs.readFileSync(file, 'utf8');
		for (const match of css.matchAll(/([a-z][a-z0-9-]*)(?:\[[^\]]*\]|:not\([^)]*\)|\.[a-z0-9_-]+)*::part\((rsm-[a-z-]+)\)/gi)) {
			pairs.push({ host: match[1], name: match[2], file: path.relative(repoRoot, file) });
		}
	}

	assert.ok(pairs.length > 20, `only ${pairs.length} part rules were found; the scan is not reading the stylesheets`);
	for (const { host, name, file } of pairs) {
		const hosts = allowed.get(name);
		assert.notEqual(hosts, undefined, `${file} paints ::part(${name}), which nothing exposes`);
		if (hosts) assert.ok(hosts.has(host), `${file} paints ${host}::part(${name}), which is not exposed inside ${host}`);
	}
});

test('a burst of rerenders inside one root costs one install, not one each', async () => {
	const post = document.createElement('shreddit-post');
	post.attachShadow({ mode: 'open' }).innerHTML = '<div class="action-row"><button data-action-bar-action="upvote"></button></div>';
	document.body.append(post);
	Shreddit.prepareShredditThing(post);
	await nextFrame();

	const calls = countQueries(post.shadowRoot);
	// Reddit streams children into a live root. A MutationObserver delivers its
	// records at the microtask checkpoint, so yielding a microtask between appends
	// makes eight separate deliveries -- eight synchronous appends would be one
	// batch and would prove nothing about throttling. All eight land well inside
	// one frame, which is the point: unthrottled this is eight installs.
	for (const index of Array.from({ length: 8 }, (_, at) => at)) {
		const span = document.createElement('span');
		span.dataset.index = String(index);
		post.shadowRoot.append(span);
		// eslint-disable-next-line no-await-in-loop
		await Promise.resolve();
	}
	await nextFrame();

	const installs = calls.filter(selector => selector === '.action-row, .shreddit-post-container').length;
	assert.equal(installs, 1, `eight batches ran the install ${installs} times`);
	post.remove();
});

test('a host that never grows a root is asked for twenty seconds and then let go', async () => {
	// The bound was documented and was not real. An aux host that never hydrates
	// in this context -- an un-upgraded award button, a composer on a locked
	// thread -- was dropped at its deadline and then re-found by the next
	// observer-driven sweep of the root it sits in, re-added with a fresh
	// deadline and the backoff reset to its fastest step. Inside a root that
	// keeps mutating that is a permanent 16ms chain of whole-tree walks.
	const comment = document.createElement('shreddit-comment');
	const shadow = comment.attachShadow({ mode: 'open' });
	const orphan = document.createElement('award-button');
	shadow.append(orphan);
	document.body.append(comment);

	const realNow = Date.now;
	let clock = realNow();
	Date.now = () => clock;
	try {
		Shreddit.prepareShredditThing(comment);
		// Past the twenty-second wait, then let the sweep that is already armed run.
		clock += 25_000;
		await new Promise(resolve => { setTimeout(resolve, 60); });

		// Now make the parent root mutate, which is what used to re-discover it.
		const before = Shreddit.shadowSweepState().pending;
		for (const index of Array.from({ length: 3 }, (_, at) => at)) {
			const filler = document.createElement('span');
			filler.dataset.index = String(index);
			shadow.append(filler);
		}
		await nextFrame();
		await new Promise(resolve => { setTimeout(resolve, 60); });

		const after = Shreddit.shadowSweepState();
		assert.equal(before, 0, 'the expired host should already have been let go');
		assert.equal(after.pending, 0, 'a mutating parent root re-enqueued a host that had run out of time');
		assert.equal(after.timerPending, false, 'the sweep is still armed with nothing to sweep');
	} finally {
		Date.now = realNow;
		comment.remove();
	}
});

test('a root whose host has left the page stops being kept current', async () => {
	// Nothing held these observers, so a thread that scrolls through a few
	// thousand comments left one per action row alive for the life of the tab.
	const action = document.createElement('shreddit-comment-action-row');
	action.attachShadow({ mode: 'open' }).innerHTML = '<span class="rpl-vote-button-group"></span>';
	document.body.append(action);
	Shreddit.prepareShredditTree(action);
	await nextFrame();

	action.remove();
	const calls = countQueries(action.shadowRoot);
	action.shadowRoot.append(document.createElement('span'));
	await nextFrame();
	action.shadowRoot.append(document.createElement('span'));
	await nextFrame();

	assert.deepEqual(calls, [], `a detached root ran the install ${calls.length} times`);
});

test('a nested host that is still waiting does not drag the sweep back to its fastest step', async () => {
	// Separate from the expiry above, and the more common shape: a host that will
	// hydrate, eventually, inside a root that keeps rerendering. Every rerender
	// re-finds it, and letting a re-found host restart the backoff pinned the
	// sweep at 16ms for as long as the parent kept mutating. Only a host arriving
	// from the document or the stream is new enough to deserve that.
	const comment = document.createElement('shreddit-comment');
	const shadow = comment.attachShadow({ mode: 'open' });
	shadow.append(document.createElement('award-button'));
	document.body.append(comment);

	try {
		Shreddit.prepareShredditThing(comment);
		// Let the sweep back off a few steps while the award button stays unhydrated.
		await new Promise(resolve => { setTimeout(resolve, 400); });
		const settled = Shreddit.shadowSweepState();
		assert.ok(settled.pending > 0, 'the unhydrated host should still be waiting');
		assert.ok(settled.backoffStep >= 3, `the sweep never backed off: step ${settled.backoffStep}`);

		// Now the parent root rerenders, which is what re-finds the nested host.
		const filler = document.createElement('span');
		shadow.append(filler);
		await nextFrame();

		const after = Shreddit.shadowSweepState();
		assert.ok(after.backoffStep >= settled.backoffStep,
			`a rerender dragged the sweep from step ${settled.backoffStep} back to ${after.backoffStep}`);
	} finally {
		comment.remove();
	}
});
