import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const lr = await loadFlowModule('lib/utils/loginRedirect.js', 'login-redirect');
const mod = readRepoFile('lib/modules/loginRedirectFix.js');

test('an ordinary path round-trips', () => {
	assert.equal(lr.safeDest('/r/aww/comments/abc/title/', '', true), '/r/aww/comments/abc/title/');
	assert.equal(lr.safeDest('/r/aww/', '?sort=new', true), '/r/aww/?sort=new');
	assert.equal(lr.safeDest('/r/aww/', 'sort=new', true), '/r/aww/?sort=new');
});

test('the query string can be dropped', () => {
	assert.equal(lr.safeDest('/r/aww/', '?q=something+private', false), '/r/aww/');
});

test('a protocol-relative path cannot escape the site', () => {
	// `dest` is a redirect target reddit honours after authenticating, so a value
	// that names a host is an open redirect. `//host` passes a naive
	// startsWith('/') check and navigates off-site.
	assert.equal(lr.safeDest('//evil.example/phish', '', true), '/');
	assert.equal(lr.safeDest('//evil.example', '?a=1', true), '/');
});

test('a backslash-prefixed path cannot escape the site', () => {
	// Several browsers normalise `/\host` to `//host`.
	assert.equal(lr.safeDest('/\\evil.example/phish', '', true), '/');
});

test('an absolute URL is refused outright', () => {
	assert.equal(lr.safeDest('https://evil.example/phish', '', true), '/');
	assert.equal(lr.safeDest('javascript:alert(1)', '', true), '/');
	assert.equal(lr.safeDest('', '', true), '/');
	assert.equal(lr.safeDest(null, null, true), '/');
});

test('control characters are refused', () => {
	// A newline in a redirect target is a header-splitting attempt, not a path.
	assert.equal(lr.safeDest('/r/aww\nSet-Cookie: x=1', '', true), '/');
	assert.equal(lr.safeDest('/r/aww\r\n', '', true), '/');
	// A tainted query drops the query rather than the whole destination.
	assert.equal(lr.safeDest('/r/aww/', '?a=b\nc', true), '/r/aww/');
});

test('the module only runs while logged out', () => {
	// Rewriting a logged-in header would touch the logout link.
	assert.match(mod, /if \(isLoggedIn\(\)\) return;/);
	assert.match(mod, /module\.disabledByDefault = true/);
});

test('the module sets dest on both the link and the form', () => {
	// The header link and the drop-down form are separate paths to the same
	// login, and reddit only honours dest when it is actually present.
	assert.match(mod, /function fixHeaderLink\(\)/);
	assert.match(mod, /function fixLoginForms\(\)/);
	assert.match(mod, /field\.name = 'dest'/);
});
