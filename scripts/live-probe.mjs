// Measure the classic layout on a live Reddit page, in a browser you are already
// signed in to.
//
// This exists because the classic-layout port is this repo's most-repeated defect
// class. Eleven commits across five days repaired it, the word "restore" appears
// in four of them, and every one of those defects was found by measuring a live
// page by hand — while the whole fixture suite stayed green. The fixtures are
// deterministic and hermetic, which is exactly why they cannot see reddit
// changing its markup. Until now the measuring was done with scratch scripts that
// were never committed, so the one procedure that catches this could not be
// repeated by anyone, including the person who wrote it, a week later.
//
// It is not a gate and it is not in `yarn verify`. It needs a signed-in browser
// and the live internet, and live current Reddit refuses an automated profile
// outright — a headless Chromium with the extension loaded gets HTTP 200 and the
// body "You've been blocked by network security". So it attaches to a browser a
// person started, rather than launching one.
//
// It only ever reads. It does not navigate, click, or resize the tab it finds:
// that is somebody's real browser, signed in to their real account, and a probe
// that drives it is a probe that cannot be run casually.
//
// Usage:
//   1. Start Chrome with remote debugging, using a profile that has the unpacked
//      extension loaded and is signed in to reddit:
//        chrome.exe --remote-debugging-port=9222
//   2. Open the reddit page you want measured (a subreddit listing, or a thread).
//   3. yarn live-probe            (add --port 9333 if you used another port)
//
// Exit code is 0 when every measurement matches, 1 when any moved, 2 when it
// could not find a page to measure.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
function flag(name, fallback) {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
}

const port = Number(flag('port', '9222'));
const verbose = args.includes('--verbose');

// What the classic layout is supposed to measure, and where each number comes
// from. These are the same values `tests/e2e/extension.test.mjs` asserts against
// the fixtures; the point of this script is to ask whether the live page still
// agrees with them.
//
// `tolerance` is not slack for a defect. Reddit's own type metrics move a row by
// a fraction of a pixel between builds, and a probe that fails on 71.6 vs 72 is a
// probe people stop running.
const EXPECTED = [
	{ id: 'voteColumnX', label: 'vote column, x offset in the row', want: 10, tolerance: 2, unit: 'px' },
	{ id: 'voteArrowWidth', label: 'vote arrow glyph width', want: 15, tolerance: 1, unit: 'px' },
	{ id: 'voteArrowHeight', label: 'vote arrow glyph height', want: 14, tolerance: 1, unit: 'px' },
	{ id: 'thumbnailBox', label: 'thumbnail box, both sides', want: 70, tolerance: 2, unit: 'px' },
	{ id: 'titleFontSize', label: 'post title size', want: 16, tolerance: 0.5, unit: 'px' },
	{ id: 'commentIndent', label: 'comment indent per nesting level', want: 18, tolerance: 2, unit: 'px' },
	{ id: 'sidebarWidth', label: 'right sidebar width', want: 300, tolerance: 4, unit: 'px' },
];

// Contrast floors, which are the half that reddit's own markup cannot break but
// a palette edit can. WCAG: text at 4.5, a non-text state indicator at 3.
const CONTRAST = [
	{ id: 'voteScore', label: 'vote score on the row', floor: 4.5 },
	{ id: 'voteArrow', label: 'vote arrow against the row', floor: 3 },
];

function fail(message, code = 2) {
	console.error(`live-probe: ${message}`);
	process.exit(code);
}

// The page half. Everything here runs in the tab and must not assume the
// extension's own globals — a content script's world is not this one.
function measureInPage() {
	const parse = value => {
		const m = String(value || '').match(/rgba?\(([^)]+)\)/);
		if (!m) return null;
		const parts = m[1].split(',').map(n => parseFloat(n));
		return parts.length >= 3 ? { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 } : null;
	};
	const luminance = ({ r, g, b }) => {
		const channel = c => {
			const s = c / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	};
	const ratio = (fg, bg) => {
		if (!fg || !bg) return null;
		const a = luminance(fg) + 0.05;
		const b = luminance(bg) + 0.05;
		return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
	};
	// The row's real background, which is whatever ancestor actually paints one.
	const groundOf = el => {
		let node = el;
		while (node && node !== document.documentElement) {
			const bg = parse(getComputedStyle(node).backgroundColor);
			if (bg && bg.a > 0) return bg;
			node = node.parentElement || (node.getRootNode() || {}).host;
		}
		return parse(getComputedStyle(document.body).backgroundColor);
	};

	const out = { renderer: null, values: {}, contrast: {}, notes: [] };

	const isClassic = document.documentElement.classList.contains('res-pageTheme--refined');
	out.renderer = document.querySelector('shreddit-app') ? 'd2x' : 'r2';
	if (!isClassic) {
		out.notes.push('res-pageTheme--refined is not on this page, so there is no classic layout to measure');
		return out;
	}

	const post = document.querySelector('shreddit-post');
	const shadow = post && post.shadowRoot;

	// Vote column and its glyph live inside reddit's own shadow root on current
	// Reddit, which is the whole reason the fixtures keep missing changes here.
	const group = shadow ? shadow.querySelector('.rpl-vote-button-group') : document.querySelector('.midcol');
	if (group) {
		// The upvote control itself, relative to the post — the same pair
		// `tests/e2e/extension.test.mjs` measures. Not the group: it starts flush
		// with the post's left edge, so measuring that reports 0 forever and the
		// probe cries wolf on a layout that is correct.
		const button = group.querySelector('[data-action-bar-action="upvote"], button, [role="button"], .arrow');
		if (button && post) {
			out.values.voteColumnX = Math.round((button.getBoundingClientRect().left - post.getBoundingClientRect().left) * 10) / 10;
		}
		if (button) {
			const style = getComputedStyle(button, '::before');
			out.values.voteArrowWidth = parseFloat(style.width);
			out.values.voteArrowHeight = parseFloat(style.height);
			const arrowInk = parse(style.backgroundColor);
			out.contrast.voteArrow = ratio(arrowInk, groundOf(button));
		}

		// Not one comma-separated query. `querySelector` returns the first match in
		// *document order*, not the first selector that matches, so a hidden label
		// or an icon wrapper sitting before the real score would have been measured
		// instead of it — and the number would have looked plausible.
		const score = group.querySelector('faceplate-number') ||
			[...group.children].find(el => el.matches('span') && !el.querySelector('button') && /\d/.test(el.textContent || ''));
		if (score) {
			out.contrast.voteScore = ratio(parse(getComputedStyle(score).color), groundOf(score));
		}
	} else {
		out.notes.push('no vote control found; is this a listing or a thread?');
	}

	const thumb = document.querySelector('[slot="thumbnail"] img, a.thumbnail img, [data-testid="post-thumbnail"] img');
	if (thumb) {
		const box = thumb.getBoundingClientRect();
		out.values.thumbnailBox = Math.max(Math.round(box.width), Math.round(box.height));
	} else {
		out.notes.push('no post thumbnail on this page');
	}

	const title = document.querySelector('[slot="title"], a.title');
	if (title) out.values.titleFontSize = parseFloat(getComputedStyle(title).fontSize);

	// Nesting is measured as the difference between a comment and its parent,
	// which is the thing that regressed twice: an absolute left offset says
	// nothing without the one above it.
	const comments = [...document.querySelectorAll('shreddit-comment[depth], .comment .comment')];
	const nested = comments.find(c => Number(c.getAttribute('depth')) === 1) ||
		comments.find(c => c.parentElement && c.parentElement.closest('shreddit-comment, .comment'));
	if (nested) {
		const parent = nested.parentElement ? nested.parentElement.closest('shreddit-comment, .comment') : null;
		const root = parent || document.querySelector('shreddit-comment[depth="0"], .commentarea .comment');
		if (root && root !== nested) {
			out.values.commentIndent = Math.round((nested.getBoundingClientRect().left - root.getBoundingClientRect().left) * 10) / 10;
		}
	} else {
		out.notes.push('no nested comment on this page; open a thread to measure indent');
	}

	const sidebar = document.querySelector('.rsm-sidebar, #siteTable + .side, aside');
	if (sidebar) out.values.sidebarWidth = Math.round(sidebar.getBoundingClientRect().width);

	return out;
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(error => {
	fail(`could not attach on port ${port}. Start Chrome with --remote-debugging-port=${port} and open a reddit page.\n  ${error.message}`);
});

const pages = browser.contexts().flatMap(context => context.pages());
const page = pages.find(p => /^https:\/\/(www|old)\.reddit\.com\//.test(p.url()));
if (!page) {
	await browser.close();
	fail(`attached on ${port} but no tab is on reddit. Open one — this script will not navigate yours.`);
}

console.log(`live-probe: measuring ${page.url()}`);
const measured = await page.evaluate(measureInPage);
// Detaches the CDP connection; it does not close the browser a person started.
await browser.close();

console.log(`renderer: ${measured.renderer}`);
for (const note of measured.notes) console.log(`  note: ${note}`);
if (verbose) console.log(JSON.stringify(measured, null, 2));

const rows = [];
let failures = 0;
let skipped = 0;

for (const { id, label, want, tolerance, unit } of EXPECTED) {
	const got = measured.values[id];
	if (got === undefined || got === null || Number.isNaN(got)) {
		rows.push(['skip', label, '—', `${want}${unit}`]);
		skipped++;
		continue;
	}
	const ok = Math.abs(got - want) <= tolerance;
	if (!ok) failures++;
	rows.push([ok ? 'ok' : 'MOVED', label, `${got}${unit}`, `${want}${unit} ±${tolerance}`]);
}

for (const { id, label, floor } of CONTRAST) {
	const got = measured.contrast[id];
	if (got === undefined || got === null || Number.isNaN(got)) {
		rows.push(['skip', label, '—', `≥${floor}:1`]);
		skipped++;
		continue;
	}
	const ok = got >= floor;
	if (!ok) failures++;
	rows.push([ok ? 'ok' : 'MOVED', label, `${got}:1`, `≥${floor}:1`]);
}

const widths = [0, 1, 2, 3].map(i => Math.max(...rows.map(r => r[i].length)));
console.log('');
for (const row of rows) {
	console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '));
}
console.log('');

// `process.exitCode` rather than `process.exit(1)`. Everything above is a table
// somebody is meant to read, and on Windows stdout to a pipe is asynchronous —
// `process.exit` would cut it off mid-print for anyone redirecting the output to
// a file, which is exactly what you do with a report. Setting the code lets the
// script end on its own with the writes drained.
if (failures) {
	console.log(`live-probe: ${failures} measurement(s) moved${skipped ? `, ${skipped} not on this page` : ''}.`);
	process.exitCode = 1;
} else {
	console.log(`live-probe: everything measured matches${skipped ? `, ${skipped} not on this page` : ''}.`);
}
