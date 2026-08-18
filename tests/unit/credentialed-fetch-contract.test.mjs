// The two things this extension hands to reddit's own page: an identifier, and a
// credentialed request built from that page's markup.
//
// Both are small. Both are the kind of thing that is only ever noticed by
// someone auditing the extension rather than by anyone using it, which is
// exactly why they need a test that fails.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const PAGE = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body class="comments-page">
	<div id="header" role="banner"></div>
	<div class="content" role="main"><div class="commentarea"><div class="sitetable nestedlisting">
		<div class="thing comment" id="thing_t1_a" data-fullname="t1_a"><div class="entry">
			<span class="deepthread"><a href="/r/test/comments/abc/x/def">continue this thread</a></span>
		</div></div>
	</div></div></div>
</body></html>`;

const Bundle = await loadModule('lib/modules/continueThreadInline.js', 'credentialed-fetch', {
	dom: { url: 'https://old.reddit.com/r/test/comments/abc/x/', html: PAGE },
	alsoExport: {
		version: 'lib/modules/version.js',
		environment: 'lib/environment/index.js',
		watchers: 'lib/utils/watchers.js',
		thing: 'lib/utils/thing.js',
	},
});

const { isSafeThreadUrl } = Bundle;

// --- the credentialed fetch --------------------------------------------------

test('a same-origin reddit comment permalink is allowed', () => {
	assert.equal(isSafeThreadUrl('https://old.reddit.com/r/test/comments/abc/some-title/def'), true);
	assert.equal(isSafeThreadUrl('/r/test/comments/abc/some-title/def'), true, 'a relative href resolves against the page, and reddit writes them relative');
	assert.equal(isSafeThreadUrl('https://old.reddit.com/r/sub_name-1/comments/1a2b3c/'), true);
});

test('a hostile href never gets the user\'s cookies', () => {
	const hostile = [
		['https://evil.example/r/test/comments/abc/x/', 'a cross-origin URL wearing a reddit-shaped path'],
		['//evil.example/r/test/comments/abc/x/', 'protocol-relative — reads as a path until the browser resolves it'],
		['javascript:fetch("https://evil.example")', 'a javascript: href is a string like any other until something runs it'],
		['data:text/html,<script>1</script>', 'data: URLs inherit nothing, but they are not a thread either'],
		['http://old.reddit.com/r/test/comments/abc/x/', 'plain http would put the session cookie on the wire'],
		['https://old.reddit.com/user/someone/', 'same origin, but not a comment thread'],
		['https://old.reddit.com/r/test/', 'nor is a subreddit listing'],
		['https://oldreddit.com.evil.example/r/x/comments/a/b/', 'a suffix attack on the hostname'],
		['', 'an anchor with no href at all'],
		[null, 'and a missing one'],
	];
	for (const [url, why] of hostile) {
		assert.equal(isSafeThreadUrl(url), false, `${String(url)} — ${why}`);
	}
});

test('nothing is fetched when the href does not pass', async () => {
	const requests = [];
	globalThis.__fetchHook = url => {
		requests.push(String(url));
		return Promise.resolve({ ok: true, status: 200, text: async () => '<html></html>' });
	};

	// A `<base>` element, not a rewritten href. The module only treats a link as a
	// "continue this thread" link if its *attribute* starts with `/r/`, so an
	// obviously cross-origin href is rejected before the guard is ever consulted —
	// and a test built that way would pass without the guard existing. A base tag
	// leaves the attribute untouched and moves where it resolves to, which is
	// precisely the markup-influencable case the guard is for.
	const base = document.createElement('base');
	base.href = 'https://evil.example/';
	document.head.append(base);

	const link = document.querySelector('.deepthread a');
	assert.equal(link.getAttribute('href'), '/r/test/comments/abc/x/def', 'the attribute still looks like reddit');
	assert.match(link.href, /^https:\/\/evil\.example\//, 'while the resolved URL is not');

	Bundle.module.contentStart();
	Bundle.watchers.registerPage(document.body);
	for (const element of document.querySelectorAll(Bundle.thing.Thing.thingSelector)) {
		const thing = Bundle.thing.Thing.from(element);
		if (thing) thing.runTasks();
	}
	link.click();
	await new Promise(resolve => setTimeout(resolve, 50));

	base.remove();
	assert.deepEqual(requests, [], 'a refusal that still sends the request is not a refusal');
	assert.match(link.className, /rsm-continue-inline-failed/, 'and the user is told it did not work rather than left watching a spinner');
});

test('the guard is applied at the fetch, not merely defined', () => {
	const source = read('lib/modules/continueThreadInline.js')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');

	const guardAt = source.indexOf('isSafeThreadUrl(a.href)');
	const fetchAt = source.indexOf("credentials: 'include'");
	assert.ok(guardAt > 0, 'the check has to be called, not just exported');
	assert.ok(fetchAt > guardAt, 'and called before the request, which is the only place it can help');
});

// --- the identifier ----------------------------------------------------------

test('the version beacon publishes a nonce, never the extension ID', () => {
	document.body.innerHTML = '<div id="header" role="banner"></div>';
	const reportVersion = Bundle.version.module.beforeLoad;
	assert.equal(typeof reportVersion, 'function');

	// `go` is where the beacon is written; run whichever stage exists rather than
	// pinning the lifecycle, which is not what this test is about.
	for (const stage of ['beforeLoad', 'go', 'contentStart']) {
		const hook = Bundle.version.module[stage];
		if (typeof hook === 'function') { try { hook(); } catch (e) { /* other stages are not under test */ } }
	}

	const beacon = document.querySelector('#RESConsoleVersion');
	assert.ok(beacon, 'the compatibility beacon still has to be published — old reddit blocks expandos without it');

	const id = beacon.getAttribute('data-id');
	assert.ok(id, 'concurrent-install detection needs the attribute to exist');
	assert.notEqual(id, Bundle.environment.getExtensionId(), 'for an unpacked install chrome derives the id from the install path, making it a stable per-machine identifier handed to the page');
	assert.match(id, /^rsm-/, 'a nonce, not an id');

	assert.equal(beacon.getAttribute('data-fork-version'), null, 'the exact build is not reddit\'s business either');
	assert.equal(beacon.textContent, 'v4.3.2.1', 'the advisory version reddit gates expandos on is unchanged — reddit blocks expandos below 4.3.2.1');
});

test('two installs on one page still look like two installs', () => {
	// The whole reason the attribute exists. A nonce satisfies it; a constant
	// would not, and neither would dropping the attribute.
	const source = read('lib/modules/version.js');
	assert.match(source, /uniqBy\(installs, e => e\.getAttribute\('data-id'\)/);
	assert.ok(!/getExtensionId/.test(source), 'the extension id must not appear in this module at all');

	document.body.innerHTML = `
		<div id="RESConsoleVersion" data-id="rsm-one">4.3.2.1</div>
		<div id="RESConsoleVersion" data-id="rsm-two">4.3.2.1</div>`;
	const ids = new Set(Array.from(document.querySelectorAll('#RESConsoleVersion')).map(e => e.getAttribute('data-id')));
	assert.equal(ids.size, 2, 'distinctness is all the feature needs, and all it should have');
});
