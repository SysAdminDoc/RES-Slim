// Every scroll listener this extension adds must be passive.
//
// A non-passive scroll listener tells the browser the handler might call
// preventDefault, so the compositor has to wait for it before scrolling. None of
// ours ever do — they close a hover, re-anchor a popover, or pick the selected
// Thing — so every one of them was buying jank for nothing. `selectedEntry` was
// the worst: `SelectedThing.selectClosestInView()` walked Things and measured
// rectangles synchronously on every scroll event, unthrottled.
//
// This scans the source rather than the built bundle because the listener
// options are what the source declares; the bundle only mirrors them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const libDir = path.join(repoRoot, 'lib');

function* jsFiles(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* jsFiles(full);
		else if (entry.name.endsWith('.js')) yield full;
	}
}

const SCROLL_ADD = /addEventListener\(\s*'scroll'/g;

// The handler is often a multi-line `idleThrottle(() => { ... })`, so the options
// object sits past several nested `)`. A lazy regex stops at the first one and
// reads a throttled-and-passive listener as neither — it would have reported the
// two correct listeners as offenders. Balance parentheses instead.
function callTextAt(source, startIndex) {
	const open = source.indexOf('(', startIndex);
	if (open === -1) return '';
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return source.slice(startIndex, i + 1);
		}
	}
	return source.slice(startIndex);
}

function scrollRegistrations() {
	const found = [];
	for (const file of jsFiles(libDir)) {
		const source = fs.readFileSync(file, 'utf8');
		for (const match of source.matchAll(SCROLL_ADD)) {
			const line = source.slice(0, match.index).split('\n').length;
			found.push({ file: path.relative(repoRoot, file), line, text: callTextAt(source, match.index) });
		}
	}
	return found;
}

test('the scan finds the scroll listeners it is meant to police', () => {
	// Without this, a regex that matched nothing would pass the suite below
	// vacuously — the failure mode this repo keeps rediscovering.
	const found = scrollRegistrations();
	assert.ok(found.length >= 6, `expected to find the known scroll listeners, found ${found.length}`);
	assert.ok(
		found.some(f => f.file.endsWith('selectedEntry.js')),
		'selectedEntry registers a scroll listener and must be covered',
	);
});

test('every scroll listener is passive', () => {
	const offenders = scrollRegistrations()
		.filter(f => !/passive:\s*true/.test(f.text))
		.map(f => `${f.file}:${f.line}`);

	assert.deepEqual(
		offenders,
		[],
		`these scroll listeners are not passive, so they can block scrolling:\n  ${offenders.join('\n  ')}`,
	);
});

test('the scroll handler that measures layout is throttled', () => {
	// Passive stops it blocking the scroll; it does not stop it running on every
	// event. The two handlers that touch layout also have to be throttled.
	const byFile = new Map(scrollRegistrations().map(r => [r.file.split(path.sep).join('/'), r.text]));
	for (const file of ['lib/modules/selectedEntry.js', 'lib/modules/showImages.js']) {
		const registration = byFile.get(file);
		assert.ok(registration, `${file} should still register a scroll listener`);
		assert.match(
			registration,
			/idleThrottle|throttle\(|requestAnimationFrame/,
			`${file} measures layout on scroll and must throttle`,
		);
	}
});
