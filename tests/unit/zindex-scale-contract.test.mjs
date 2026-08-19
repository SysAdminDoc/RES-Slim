import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { stripComments } from './helpers/readCode.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scalePath = path.join(repoRoot, 'lib', 'css', '_zindex.scss');

// Values this small cannot compete with page chrome; they order siblings inside a
// component that has already won its place on the page. Each entry is asserted to
// still be small, so an allowlist cannot quietly come to cover a page-level value.
const LOCAL_CONTEXT_CEILING = 50;

function collectScss(dir, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectScss(full, found);
		else if (entry.name.endsWith('.scss')) found.push(full);
	}
	return found;
}

function toPosix(absolute) {
	return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

test('the scale is a contiguous set of role slots on one base', () => {
	const scale = fs.readFileSync(scalePath, 'utf8');
	const tokens = [...scale.matchAll(/^\$(zindex-[a-z-]+):\s*_\((\d+)\);/gm)]
		.map(([, name, slot]) => ({ name, slot: Number(slot) }));

	assert.ok(tokens.length >= 10, `expected the scale, found ${tokens.length} tokens`);

	// Two slots must remain free rather than be reused: 10 held the alert token
	// until Alert became a native <dialog>, and 4 and 11 opened up when the
	// orphan-only tokens went. Renumbering to close the gaps would change shipped
	// values for no gain.
	const slots = tokens.map(t => t.slot);
	assert.equal(new Set(slots).size, slots.length, 'two tokens share a slot, so their order is source-dependent');
	assert.deepEqual(slots, [...slots].sort((a, b) => a - b), 'the tokens are not in slot order, which makes the file unreadable as a ladder');

	// The invariant that actually matters between two of them.
	const slotOf = name => tokens.find(t => t.name === name)?.slot;
	assert.ok(slotOf('zindex-autocomplete-dropdown') > slotOf('zindex-big-editor'),
		'the autocomplete opens from inside the big editor and has to cover it');
	assert.ok(slotOf('zindex-dropdown-menu') > slotOf('zindex-floating-panel'),
		'a menu has to cover the panel it opens from');
	assert.ok(slotOf('zindex-page-chrome') < Math.min(...slots.filter(s => s > slotOf('zindex-page-chrome'))),
		'the sticky header is the floor: every other surface must be able to cover it');
});

test('no token in the scale is unreferenced', () => {
	const scale = fs.readFileSync(scalePath, 'utf8');
	const names = [...scale.matchAll(/^\$(zindex-[a-z-]+):/gm)].map(match => match[1]);
	const users = collectScss(path.join(repoRoot, 'lib'))
		.filter(file => file !== scalePath)
		.map(file => fs.readFileSync(file, 'utf8'))
		.join('\n');

	// Six of twelve tokens were dead before v0.40.0, every one of them referenced
	// only from a partial no entry point compiled. A scale is a shared vocabulary;
	// entries nothing says are not vocabulary, they are decoration that makes the
	// live entries harder to find.
	const unused = names.filter(name => !users.includes(`$${name}`));
	assert.deepEqual(unused, [], `tokens nothing references:\n  ${unused.join('\n  ')}`);
});

test('every page-level stacking value comes from the scale', () => {
	const offenders = [];
	for (const file of collectScss(path.join(repoRoot, 'lib'))) {
		const relative = toPosix(file);
		// `lib/vendor/` is third-party CSS carried verbatim; rewriting its stacking
		// values would be editing someone else's stylesheet to satisfy our audit.
		if (relative.startsWith('lib/vendor/')) continue;

		stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, index) => {
			const match = /z-index:\s*(-?\d+)/.exec(line);
			if (!match) return;
			const value = Number(match[1]);
			if (Math.abs(value) <= LOCAL_CONTEXT_CEILING) return;
			offenders.push(`${relative}:${index + 1} — z-index: ${value}`);
		});
	}

	// The numbers this replaced: 1000 (four different surfaces), 2001, 9999 (four
	// more), 99999, 100000, 10000000 and 99999999, next to a scale whose smallest
	// member was 10,100,000. Nothing was ordered relative to anything else.
	assert.deepEqual(offenders, [],
		`page-level z-index values outside the scale:\n  ${offenders.join('\n  ')}`);
});

test('no stacking value is written from JS', () => {
	const jsFiles = [];
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.js')) jsFiles.push(full);
		}
	};
	walk(path.join(repoRoot, 'lib'));

	// `nextTopComment` wrote `z-index:9999` into an inline style attribute, so a
	// page-level stacking value sat in a template literal where no stylesheet
	// audit could reach it — including the one above.
	const offenders = jsFiles
		.filter(file => /z-?[iI]ndex\s*[:=]\s*['"`]?\d/.test(fs.readFileSync(file, 'utf8')))
		.map(toPosix);
	assert.deepEqual(offenders, [], `stacking values written from JS:\n  ${offenders.join('\n  ')}`);
});

test('the two top-layer surfaces carry no stacking value at all', () => {
	for (const [name, file] of [
		['overlayViewer', 'lib/css/modules/_overlayViewer.scss'],
		['hoverZoom', 'lib/css/modules/_hoverZoom.scss'],
	]) {
		const source = stripComments(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
		assert.ok(!/z-index:/.test(source),
			`${name} is in the top layer; a z-index there is a number that could be beaten`);
	}

	// And the elements really are in the top layer, not merely un-numbered.
	const overlay = fs.readFileSync(path.join(repoRoot, 'lib/modules/overlayViewer.js'), 'utf8');
	assert.match(overlay, /createElement\('dialog'\)/);
	assert.match(overlay, /overlay\.showModal\(\)/);
	const zoom = fs.readFileSync(path.join(repoRoot, 'lib/modules/hoverZoom.js'), 'utf8');
	assert.match(zoom, /setAttribute\('popover', 'manual'\)/);
	assert.match(zoom, /pop\.showPopover\(\)/);
});
