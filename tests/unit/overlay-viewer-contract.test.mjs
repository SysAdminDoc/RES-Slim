import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/overlayViewer.js'), 'utf8');
// Absence assertions have to read the code, not the prose about it: this module's
// comments name `aria-modal` and `role` precisely to explain why they are gone,
// and a scanner that reads its own explanation as the thing it forbids is a
// scanner that fails on a correct file.
const modCode = modSource
	.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
	.replace(/(^|\s)\/\/[^\r\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('overlayViewer module is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as overlayViewer \} from '\.\/overlayViewer';/);
	assert.match(indexSource, /^\s*overlayViewer,/m);
});

test('overlayViewer is disabled by default and includes the documented options', () => {
	assert.match(modSource, /module\.disabledByDefault = true;/);
	for (const opt of ['includeSelftext', 'includeCommentImages', 'dimBackground']) {
		assert.ok(modSource.includes(opt), `expected option ${opt}`);
	}
});

test('overlayViewer routes every exit through one path, including Escape', () => {
	// Escape used to be a document-level keydown listener. It is the dialog's own
	// `cancel` event now, taken over so that closing always runs closeOverlay():
	// letting the default run would close the element while skipping the body
	// class and the focus restore, which live there and nowhere else.
	assert.match(modSource, /addEventListener\('cancel'/);
	assert.match(modSource, /e\.preventDefault\(\);\s*\n\s*closeOverlay\(\);/);
	assert.match(modSource, /e\.target === overlay/);
	// The module binds no keydown listener at all now.
	assert.doesNotMatch(modCode, /addEventListener\(['"]keydown['"]/);
});

test('overlayViewer skips modifier-key clicks so Ctrl+click open-in-new-tab still works', () => {
	assert.match(modSource, /e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey \|\| e\.altKey/);
});

test('overlayViewer targets images inside expando / selftext / comment-body', () => {
	assert.match(modSource, /\.expando img/);
	assert.match(modSource, /\.usertext-body \.md img/);
	assert.match(modSource, /\.thing\.comment/);
});

test('overlayViewer is a real modal rather than a div describing itself as one', () => {
	// `role="dialog"` and `aria-modal="true"` were the div asking for behaviour it
	// could not have: no top layer, no inertness, no focus containment. A <dialog>
	// opened with showModal() means all three, so stating them by hand is both
	// redundant and a claim the element can no longer fail to honour.
	assert.match(modSource, /createElement\('dialog'\)/);
	assert.match(modSource, /overlay\.showModal\(\)/);
	assert.doesNotMatch(modCode, /setAttribute\('role', 'dialog'\)/);
	assert.doesNotMatch(modCode, /aria-modal/);
	assert.match(modSource, /aria-labelledby/);
	assert.match(modSource, /aria-describedby/);
	assert.match(modSource, /closeBtn\.focus\(\)/);
	// Closing has to leave the top layer before leaving the document.
	assert.match(modSource, /overlay\.open && typeof overlay\.close === 'function'/);
});

test('overlayViewer exposes premium loading/error/original-link controls', () => {
	assert.match(modSource, /dataset\.state = 'loading'/);
	assert.match(modSource, /Open original/);
	assert.match(modSource, /setAttribute\('role', 'status'\)/);
	assert.match(modSource, /display\.addEventListener\('load'/);
	assert.match(modSource, /display\.addEventListener\('error'/);
});

test('the focus trap is the browser\'s, and the focus restore is still the module\'s', () => {
	// Forty lines of Tab cycling went away with showModal(); the restore did not,
	// because <dialog> returns focus to the invoker only for a dialog it opened
	// from a form or a button it can identify, and this one opens from a click on
	// an image anywhere in the page.
	assert.doesNotMatch(modCode, /focusableOverlayControls/);
	assert.doesNotMatch(modCode, /e\.key === 'Tab'/);
	assert.match(modSource, /_restoreFocus/);
	assert.match(modSource, /restoreFocus\.focus\(\)/);
});

test('overlayViewer SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_overlayViewer.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /#rsm-overlayViewer/);
	// The top layer is the whole point: a z-index here would be a number that
	// something else could beat, which is exactly how a hover card came to paint
	// over the open viewer.
	assert.doesNotMatch(scss, /z-index:/);
	assert.match(scss, /&::backdrop/);
	// A <dialog> arrives with UA styles a <div> never had. Left alone they collapse
	// the full-bleed box to a bordered, auto-margined card.
	for (const reset of ['margin: 0', 'border: 0', 'width: auto', 'height: auto']) {
		assert.ok(scss.includes(reset), `expected the dialog UA reset \`${reset}\``);
	}
	assert.match(scss, /#rsm-overlayViewer-toolbar/);
	assert.match(scss, /#rsm-overlayViewer-status/);
	assert.match(scss, /\[data-state='error'\]/);
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/overlayViewer'/);
	// Reduced motion is honoured once in the token layer for every rsm- surface
	// rather than per module, so the viewer's fade, rise and loading sweep are
	// all covered by the shared rule. Assert the rule and the import that pulls
	// it in ahead of the modules.
	assert.match(resScss, /@import 'tokens'/);
	const tokens = fs.readFileSync(path.join(repoRoot, 'lib/css/_tokens.scss'), 'utf8');
	assert.match(tokens, /prefers-reduced-motion: reduce/);
	assert.match(tokens, /\[id\^='rsm-'\]::before/);
});
