import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/roleHighlights.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('roleHighlights module is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as roleHighlights \} from '\.\/roleHighlights';/);
	assert.match(indexSource, /^\s*roleHighlights,/m);
});

test('roleHighlights ships an option per role plus shared modifiers', () => {
	for (const opt of [
		'highlightOP', 'opColor',
		'highlightMod', 'modColor',
		'highlightAdmin', 'adminColor',
		'highlightFriend', 'friendColor',
		'animateRoleFlair', 'backdropHighlight',
	]) {
		assert.ok(modSource.includes(opt), `expected option ${opt} to be declared`);
	}
});

test('roleHighlights defaults turn OP / mod / admin on; friend / animation / backdrop off', () => {
	// Lightweight string-based assertion against the source — the schema declares
	// `value: true` or `value: false` per option.
	function pickDefault(opt) {
		const re = new RegExp(`${opt}\\s*:\\s*\\{[\\s\\S]*?value:\\s*(true|false)`);
		const m = re.exec(modSource);
		return m ? m[1] : '';
	}
	assert.equal(pickDefault('highlightOP'), 'true');
	assert.equal(pickDefault('highlightMod'), 'true');
	assert.equal(pickDefault('highlightAdmin'), 'true');
	assert.equal(pickDefault('highlightFriend'), 'false');
	assert.equal(pickDefault('animateRoleFlair'), 'false');
	assert.equal(pickDefault('backdropHighlight'), 'false');
});

test('roleHighlights body classes follow the rsm-role-* convention', () => {
	assert.match(modSource, /rsm-role-op/);
	assert.match(modSource, /rsm-role-mod/);
	assert.match(modSource, /rsm-role-admin/);
	assert.match(modSource, /rsm-role-friend/);
});

test('roleHighlights references the stable author class selectors', () => {
	assert.match(modSource, /a\.author\.submitter/);
	assert.match(modSource, /a\.author\.moderator/);
	assert.match(modSource, /a\.author\.admin/);
	assert.match(modSource, /a\.author\.friend/);
});

test('animated shimmer is reduced-motion-aware', () => {
	assert.match(modSource, /prefers-reduced-motion: reduce/);
	assert.match(modSource, /rsm-role-shimmer/);
});

test('module ships document-start anti-FOUC + contentStart apply', () => {
	assert.match(modSource, /module\.beforeLoad\s*=/);
	assert.match(modSource, /module\.contentStart\s*=/);
	assert.match(modSource, /STYLE_ID = 'RSMRoleHighlightsStyle'/);
});
