// The DOM half of the visited-link feature, executed.
//
// `visited-links-contract` covers the pure helpers and the manifests. Nothing
// covered the wiring, and that is exactly where the bug was: the class was only
// applied at the moment a link was expanded, so the store was written and never
// read, and a reload lost every mark. The helpers were tested; the seam was not.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';
import { codeOnly, readRepoFile } from './helpers/loadFlowModule.mjs';

installDom();
const MediaControls = await loadModule('lib/modules/showImages/mediaControls.js', 'visited-marking');
const { VISITED_CLASS, markLinkVisited, markVisitedIfKnown, trackMediaLoad } = MediaControls;


// The showImages module object reached through the SAME bundle. A second
// loadModule call would build an independent bundle whose module object the code
// under test never sees, so setting an option on it would change nothing.
const showImages = MediaControls.__registry.getUnchecked('showImages');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function anchor(href = 'https://i.imgur.com/abc123.png') {
	const a = document.createElement('a');
	a.href = href;
	document.body.append(a);
	return a;
}

function withMarkVisited(value, fn) {
	const previous = showImages.options.markVisited.value;
	showImages.options.markVisited.value = value;
	try {
		return fn();
	} finally {
		showImages.options.markVisited.value = previous;
	}
}

test('the class name is the one the stylesheet targets', () => {
	assert.equal(VISITED_CLASS, 'res-visited-link');

	// A rename on either side silently removes the styling with nothing thrown.
	const scss = readRepoFile('lib/css/modules/_showImages.scss');
	assert.ok(scss.includes(`.${VISITED_CLASS}`), 'the stylesheet must style the class the code applies');
});

test('markLinkVisited applies the class and tolerates a missing element', () => {
	const link = anchor();
	markLinkVisited(link);
	assert.equal(link.classList.contains(VISITED_CLASS), true);

	assert.doesNotThrow(() => markLinkVisited(null));
	assert.doesNotThrow(() => markLinkVisited({}));
});

test('expanding a link marks it and records it', () => {
	withMarkVisited(true, () => {
		const link = anchor();
		trackMediaLoad(link, null);
		assert.equal(link.classList.contains(VISITED_CLASS), true, 'the link the user just expanded should be marked immediately');
	});
});

test('with the option off, expanding marks nothing', () => {
	withMarkVisited(false, () => {
		const link = anchor();
		trackMediaLoad(link, null);
		assert.equal(link.classList.contains(VISITED_CLASS), false);
	});
});

// The regression this file exists for: a link visited on an *earlier* page load
// must be marked again on a fresh page, without the user expanding anything.
test('a previously visited link is re-marked on a later page load', async () => {
	await withMarkVisited(true, async () => {
		const href = 'https://i.imgur.com/seen-before.png';

		// First visit. trackMediaLoad deliberately does not await the write, so let
		// the storage promise chain settle before reading it back — a macrotask
		// boundary flushes every pending microtask.
		trackMediaLoad(anchor(href), null);
		await settle();

		// A fresh page: a brand new anchor for the same URL, unmarked.
		const later = anchor(href);
		assert.equal(later.classList.contains(VISITED_CLASS), false, 'sanity: a fresh anchor starts unmarked');

		await markVisitedIfKnown(later);
		assert.equal(later.classList.contains(VISITED_CLASS), true, 'the store must be read back, not just written');
	});
});

test('a link that was never visited is left alone', async () => {
	await withMarkVisited(true, async () => {
		const fresh = anchor('https://i.imgur.com/never-seen.png');
		await markVisitedIfKnown(fresh);
		assert.equal(fresh.classList.contains(VISITED_CLASS), false);
	});
});

test('re-marking is gated by the same option as recording', async () => {
	const href = 'https://i.imgur.com/gated.png';
	await withMarkVisited(true, async () => { trackMediaLoad(anchor(href), null); });

	await withMarkVisited(false, async () => {
		const later = anchor(href);
		await markVisitedIfKnown(later);
		assert.equal(later.classList.contains(VISITED_CLASS), false, 'turning the feature off must stop it marking, not just recording');
	});
});

test('markVisitedIfKnown tolerates junk without throwing', async () => {
	await withMarkVisited(true, async () => {
		for (const junk of [null, undefined, {}, { href: '' }]) {
			await assert.doesNotReject(() => markVisitedIfKnown(junk));
		}
	});
});

// Wiring: the scan must call it, or the read-back never happens on a real page.
test('the link scanner restores the mark for every link it examines', () => {
	const scanner = codeOnly(readRepoFile('lib/modules/showImages/linkScanner.js'));

	assert.ok(scanner.includes('markVisitedIfKnown'), 'checkElementForMedia should restore the mark');
	assert.match(
		scanner,
		/export async function checkElementForMedia\([^)]*\)\s*\{[\s\S]{0,400}?markVisitedIfKnown\(/,
		'the call must be near the top of checkElementForMedia, before any early return can skip it',
	);
});

// The mark must not be an opacity dim. Opacity blends text toward the background
// and so cuts contrast directly — the first version took old.reddit's link blue
// from 4.49:1 to 2.58:1 and nightMode's from 8.02:1 to 4.24:1, both below AA —
// and it is the one property a theme cannot correct for.
test('the visited mark does not reduce text contrast', () => {
	const scss = readRepoFile('lib/css/modules/_showImages.scss');
	const rule = scss.slice(scss.indexOf(`a.${VISITED_CLASS}`));
	const block = rule.slice(0, rule.indexOf('}') + 1);

	assert.ok(block.length, 'sanity: the visited-link rule should exist');
	assert.ok(!/\bopacity\s*:/.test(block), `the mark must not dim the link text: ${block}`);
	assert.ok(!/\bfilter\s*:/.test(block), 'filter has the same contrast-reducing effect as opacity');
});

test('the visited mark is a shape, not colour alone', () => {
	const scss = readRepoFile('lib/css/modules/_showImages.scss');
	const rule = scss.slice(scss.indexOf(`a.${VISITED_CLASS}`));
	const block = rule.slice(0, rule.indexOf('}') + 1);

	// A pseudo-element drawn in currentColor adds a mark without touching the
	// text's own colour, so it survives every theme with no per-skin variant.
	assert.match(block, /::before|::after/, 'the mark should be a drawn pseudo-element');
	assert.match(block, /currentcolor/i, 'drawing in currentColor is what makes it theme-proof');
	assert.ok(
		!/\bcolor\s*:\s*#/.test(block),
		'a hardcoded colour would be wrong in at least one of the six pageTheme palettes',
	);
});
