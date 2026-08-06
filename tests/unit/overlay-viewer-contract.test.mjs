import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/overlayViewer.js'), 'utf8');
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

test('overlayViewer respects Escape / outside-click and never sets a feature shortcut', () => {
	assert.match(modSource, /e\.key === 'Escape'/);
	assert.match(modSource, /e\.target === overlay/);
	// No keyboard-shortcut binding outside the documented Esc handler.
	assert.doesNotMatch(modSource, /addEventListener\(['"]keydown['"][\s\S]*key === ['"]a['"]/);
});

test('overlayViewer skips modifier-key clicks so Ctrl+click open-in-new-tab still works', () => {
	assert.match(modSource, /e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey \|\| e\.altKey/);
});

test('overlayViewer targets images inside expando / selftext / comment-body', () => {
	assert.match(modSource, /\.expando img/);
	assert.match(modSource, /\.usertext-body \.md img/);
	assert.match(modSource, /\.thing\.comment/);
});

test('overlayViewer sets aria-modal and moves focus to the close button', () => {
	assert.match(modSource, /aria-modal/);
	assert.match(modSource, /aria-labelledby/);
	assert.match(modSource, /aria-describedby/);
	assert.match(modSource, /closeBtn\.focus\(\)/);
});

test('overlayViewer exposes premium loading/error/original-link controls', () => {
	assert.match(modSource, /dataset\.state = 'loading'/);
	assert.match(modSource, /Open original/);
	assert.match(modSource, /setAttribute\('role', 'status'\)/);
	assert.match(modSource, /display\.addEventListener\('load'/);
	assert.match(modSource, /display\.addEventListener\('error'/);
});

test('overlayViewer traps focus and restores the prior focused element', () => {
	assert.match(modSource, /focusableOverlayControls/);
	assert.match(modSource, /e\.key === 'Tab'/);
	assert.match(modSource, /_restoreFocus/);
	assert.match(modSource, /restoreFocus\.focus\(\)/);
});

test('overlayViewer SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_overlayViewer.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /#rsm-overlayViewer/);
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
