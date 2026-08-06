import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const mod = read('lib/modules/hideAll.js');
const scss = read('lib/css/modules/_hideAll.scss');

// The module's header explains what the original userscript did, naming the
// reddit internals it borrowed. Those names are prose, not calls, so the
// page-world checks below run against code with comments stripped.
const modCode = mod
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.split('\n')
	.map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
	.join('\n');

test('hideAll is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as hideAll \} from '\.\/hideAll'/);
	assert.match(index, /\n\thideAll,/);
});

test('hideAll ships its stylesheet through res.scss', () => {
	assert.match(read('lib/css/res.scss'), /@import 'modules\/hideAll';/);
	assert.match(scss, /\.rsm-hideAll-link/);
});

test('hideAll is opt-in and scoped to listing pages', () => {
	assert.match(mod, /module\.disabledByDefault = true/);
	assert.match(mod, /module\.include = \['linklist', 'search', 'profile'\]/);
	assert.match(mod, /isPageType\('linklist', 'search', 'profile'\)/);
});

test('hideAll never borrows reddit page-world JavaScript', () => {
	// The userscript this replaces appended a <script> element so it could call
	// reddit's own jQuery helpers. A content script must not do that: the page
	// CSP can refuse it, and reddit's internals are not an API.
	assert.doesNotMatch(modCode, /createElement\('script'\)/);
	assert.doesNotMatch(modCode, /get_form_fields|thing_id\(\)|hide_thing|reddit\.modhash/);
	assert.doesNotMatch(modCode, /document\.evaluate|XPathResult/);
	// And it must not report through a blocking dialog.
	assert.doesNotMatch(modCode, /\balert\(|\bconfirm\(/);
	assert.match(modCode, /showNotification\(/);

	// The comment-stripper has to actually strip, or the checks above pass for
	// the wrong reason.
	assert.match(mod, /get_form_fields/, 'the header should still describe the original');
	assert.doesNotMatch(modCode, /Greasy Fork/);
});

test('hideAll refuses to run without a modhash rather than failing silently', () => {
	// reddit answers 403 or quietly ignores the POST, so the posts stay visible
	// while the run looks successful. markAllRead sets the same precedent.
	assert.match(mod, /function modhash\(\)/);
	assert.match(mod, /if \(!uh\) \{/);
    assert.match(mod, /could not read your login token/);
});

test('hideAll throttles its requests', () => {
	// One unthrottled POST per post is what the original author complained about
	// in his own source comments.
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /limiter\.schedule\(/);
	assert.match(mod, /requestsPerSecond/);
});

test('hideAll is reversible, and the undo reports its own failures', () => {
	assert.match(mod, /'\/api\/hide'/);
	assert.match(mod, /'\/api\/unhide'/);
	assert.match(mod, /async function undo\(/);
	assert.match(mod, /Undo/);
	// A partial undo must not read as a complete one.
	assert.match(mod, /could not be restored/);
});

test('hideAll only targets visible, unhidden posts it has a fullname for', () => {
	assert.match(mod, /Thing\.visibleThings\(document\)/);
	assert.match(mod, /thing\.isPost\(\)/);
	assert.match(mod, /if \(!thing\.getFullname\(\)\) return false/);
	assert.match(mod, /classList\.contains\('hidden'\)/);
	assert.match(mod, /skipStickied/);
});

test('hideAll reports an empty run instead of doing nothing visible', () => {
	assert.match(mod, /Nothing left to hide on this page/);
});

test('the source userscript is credited but never vendored or shipped', () => {
	// This repo rewrites userscripts rather than bundling them — the sources are
	// third-party and separately licensed, so only the provenance is recorded.
	// The file itself stays untracked, which is why nothing here asserts it
	// exists: that would fail for anyone who clones the repo.
	assert.match(mod, /Reddit Hide All/, 'the module header should credit the original');
	assert.match(mod, /Greasy Fork/, 'the module header should cite where it came from');

	assert.doesNotMatch(read('build.js'), /Reddit_Hide_All/);
	for (const file of fs.readdirSync(path.join(repoRoot, 'lib/modules')).filter(f => f.endsWith('.js'))) {
		assert.doesNotMatch(read(`lib/modules/${file}`), /Reddit_Hide_All\.user/,
			`${file} must not import the reference userscript`);
	}
	// And a stray copy must never become part of the build.
	assert.match(read('.eslintignore'), /\/\*\.user\.js/);
});
