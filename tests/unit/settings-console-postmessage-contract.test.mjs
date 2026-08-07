import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const { isRedditOrigin, isTrustedConsoleOrigin, sanitizeContext } =
	await loadFlowModule('lib/utils/trustedOrigin.js', 'trusted-origin');

const console_ = readRepoFile('lib/options/settingsConsole.js');
const context = readRepoFile('lib/environment/foreground/context.js');

const OPTIONS_ORIGIN = 'chrome-extension://28d1c92ee72e3b2f56327d428e883526';

test('a reddit origin is accepted', () => {
	for (const origin of [
		'https://www.reddit.com',
		'https://old.reddit.com',
		'https://reddit.com',
		'https://sh.reddit.com',
	]) {
		assert.equal(isRedditOrigin(origin), true, origin);
	}
});

test('lookalike origins are rejected', () => {
	// The suffix match has to be on the dot, or every one of these passes.
	for (const origin of [
		'https://notreddit.com',
		'https://reddit.com.attacker.test',
		'https://evil-reddit.com',
		'https://xreddit.com',
	]) {
		assert.equal(isRedditOrigin(origin), false, origin);
	}
});

test('a value carrying a path or query is not an origin', () => {
	// `https://evil.example/?x=https://reddit.com` is the classic way past a
	// naive `includes('reddit.com')` or a lax URL parse.
	assert.equal(isRedditOrigin('https://evil.example/?next=https://reddit.com'), false);
	assert.equal(isRedditOrigin('https://www.reddit.com/r/aww'), false);
	assert.equal(isRedditOrigin('https://www.reddit.com/'), false);
});

test('non-string and non-http origins are rejected', () => {
	for (const origin of [null, undefined, 42, {}, [], '', 'null', 'javascript:alert(1)', 'file:///etc/passwd']) {
		assert.equal(isRedditOrigin(origin), false, String(origin));
	}
	// `postMessage` from a sandboxed frame reports the literal string "null".
	assert.equal(isTrustedConsoleOrigin('null', OPTIONS_ORIGIN), false);
});

test('the extension\'s own options origin is trusted, and nothing else extension-shaped is', () => {
	assert.equal(isTrustedConsoleOrigin(OPTIONS_ORIGIN, OPTIONS_ORIGIN), true);
	assert.equal(isTrustedConsoleOrigin('chrome-extension://someotherextensionid', OPTIONS_ORIGIN), false);
	// A missing options origin must not turn into a wildcard.
	assert.equal(isTrustedConsoleOrigin(OPTIONS_ORIGIN, null), false);
	assert.equal(isTrustedConsoleOrigin('', ''), false);
	assert.equal(isTrustedConsoleOrigin(undefined, undefined), false);
});

test('a hostile context payload cannot set the request origin', () => {
	// This is the actual attack: `origin` becomes the base URL for every
	// options-page request, which are sent with credentials and an X-Modhash
	// header, and the base for every rewritten console link.
	assert.equal(sanitizeContext({ context: { origin: 'https://evil.example' } }), null);
	assert.equal(sanitizeContext({ context: { origin: 'https://reddit.com.attacker.test' } }), null);

	// A legitimate one survives.
	assert.deepEqual(
		sanitizeContext({ context: { origin: 'https://old.reddit.com' } }),
		{ origin: 'https://old.reddit.com' },
	);
});

test('a hostile payload cannot inject a userHash of the wrong type', () => {
	assert.equal(sanitizeContext({ context: { userHash: { toString: 'nope' } } }), null);
	assert.equal(sanitizeContext({ context: { userHash: 12345 } }), null);
	assert.deepEqual(sanitizeContext({ context: { userHash: 'abc123' } }), { userHash: 'abc123' });
	assert.deepEqual(sanitizeContext({ context: { userHash: null } }), { userHash: null });
});

test('a malformed or null payload is rejected without throwing', () => {
	// A throw here used to leave the console permanently in `failedToLoad` via
	// the `.catch` in options.entry.js.
	for (const payload of [null, undefined, 0, '', 'string', [], {}, { context: null }, { context: 'x' }, { context: [] }, { notContext: {} }]) {
		assert.doesNotThrow(() => sanitizeContext(payload));
		assert.equal(sanitizeContext(payload), null, JSON.stringify(payload));
	}
});

test('only known fields are copied out of a trusted payload', () => {
	// settingsNavigation posts several different shapes to the same window, and
	// a blanket Object.assign would carry any of them straight onto the context.
	const result = sanitizeContext({
		context: {
			origin: 'https://old.reddit.com',
			pathname: '/r/aww/',
			username: 'someone',
			userHash: 'abc',
			// Not part of the contract; must not survive.
			__proto__unsafe: 'x',
			close: true,
			load: { moduleID: 'evil' },
		},
	});
	assert.deepEqual(Object.keys(result).sort(), ['origin', 'pathname', 'userHash', 'username']);
});

test('a pathname that is not a path is dropped', () => {
	assert.equal(sanitizeContext({ context: { pathname: 'https://evil.example' } }), null);
	assert.deepEqual(sanitizeContext({ context: { pathname: '/r/aww/' } }), { pathname: '/r/aww/' });
});

test('the bootstrap keeps waiting instead of resolving on an untrusted message', () => {
	// waitForEvent resolves on the first message from anyone — using it here is
	// the bug. The listener must return without resolving, and stay attached.
	assert.doesNotMatch(context, /waitForEvent\(window, 'message'\)/);
	assert.match(context, /if \(!isTrustedConsoleOrigin\(event\.origin, optionsOrigin\)\) return;/);
	assert.match(context, /const context = sanitizeContext\(event\.data\);\s*\n\s*if \(!context\) return;/);
	assert.match(context, /window\.addEventListener\('message', onMessage\)/);
});

test('the bootstrap gives up rather than hanging forever', () => {
	// With the origin check added, a page that never posts a trusted context
	// would leave the console blank indefinitely.
	assert.match(context, /CONTEXT_TIMEOUT_MS/);
	assert.match(context, /setTimeout\(\(\) => \{[\s\S]{0,240}done\(\);\s*\}, CONTEXT_TIMEOUT_MS\)/);
	assert.match(context, /removeEventListener\('message', onMessage\)/);
});

test('the console handler still validates its sender, via the shared predicate', () => {
	assert.match(console_, /window\.addEventListener\('message', \(\{ origin, data \}\) => \{/);
	assert.match(console_, /if \(!isTrustedConsoleOrigin\(origin, getOptionsURL\(\)\.origin\)\) return;/);
	// The local copy is gone, so both callers cannot drift apart again.
	assert.doesNotMatch(console_, /function isTrustedConsoleOrigin\(/);
	assert.match(console_, /import \{ isTrustedConsoleOrigin \} from '\.\.\/utils\/trustedOrigin'/);
});
