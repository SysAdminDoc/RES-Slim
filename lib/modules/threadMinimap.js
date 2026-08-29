/* @flow */
// RES-Slim: build a slim vertical minimap of the comment thread on the right
// side of the page. Each .thing.comment paints a stripe at its proportional
// y-position, coloured by depth. A scrubber overlay shows the viewport. Click
// a stripe to jump to that comment.
//
// Acceptance: does not block comment scrolling — the strip uses fixed
// positioning with auto pointer events only on itself.

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('threadMinimap');

module.moduleName = 'Thread minimap';
module.category = 'commentsCategory';
module.description = 'Vertical heatmap of the current comment tree. Color by depth, click to jump, viewport overlay shows position.';
module.descriptionRaw = true;
module.include = ['comments'];
module.keywords = ['comment', 'minimap', 'heatmap', 'overview', 'navigation', 'depth'];

module.options = {
	side: {
		type: 'enum',
		value: 'right',
		title: 'Side of the page',
		description: 'Which side of the viewport the minimap docks to.',
		values: [
			{ name: 'Right', value: 'right' },
			{ name: 'Left', value: 'left' },
		],
	},
	colourMode: {
		type: 'enum',
		value: 'depth',
		title: 'Color mode',
		description: 'How each stripe is colored.',
		values: [
			{ name: 'By comment depth', value: 'depth' },
			{ name: 'By score', value: 'score' },
		],
	},
};

const MINIMAP_ID = 'RSMThreadMinimap';
const RAIL_CLASS = 'rsm-thread-minimap';

let minimap: ?HTMLElement = null;
let rail: ?HTMLElement = null;
let viewport: ?HTMLElement = null;
let renderTimer: TimeoutID | null = null;

function depthColor(depth: number): string {
	// Same hue as the OLED accent, varying lightness by depth.
	const lightness = Math.max(28, 68 - depth * 6);
	return `hsl(28, 80%, ${lightness}%)`;
}

function scoreColor(score: number): string {
	if (score > 100) return '#ffb06a';
	if (score > 10) return '#ff7a18';
	if (score >= 0) return '#7d8a99';
	return '#f85149';
}

function getCommentDepth(el: Element): number {
	let depth = 0;
	let parent = el.parentElement;
	while (parent) {
		if (parent.classList.contains('child')) depth += 1;
		parent = parent.parentElement;
	}
	return depth;
}

function getCommentScore(el: Element): number {
	const span = el.querySelector(':scope > .entry .score.unvoted, :scope > .entry .score.likes, :scope > .entry .score.dislikes');
	if (!span) return 0;
	const text = (span.textContent || '').trim().split(/\s+/)[0];
	const n = parseInt(text, 10);
	return Number.isFinite(n) ? n : 0;
}

function ensureContainer() {
	if (minimap && document.body.contains(minimap)) return minimap;
	minimap = document.createElement('aside');
	minimap.id = MINIMAP_ID;
	minimap.className = RAIL_CLASS;
	minimap.dataset.side = module.options.side.value;
	// Not aria-hidden. The rail reads as decoration, but its stripes are buttons
	// with accessible names and are reachable by Tab, and focus inside an
	// aria-hidden subtree is announced as nothing at all - the worst of both, since
	// the control is still reachable and now unnamed. A labelled navigation
	// landmark describes what it actually is.
	minimap.setAttribute('role', 'navigation');
	minimap.setAttribute('aria-label', 'Comment minimap');

	rail = document.createElement('div');
	rail.className = 'rsm-thread-minimap-rail';
	minimap.append(rail);

	viewport = document.createElement('div');
	viewport.className = 'rsm-thread-minimap-viewport';
	minimap.append(viewport);

	document.body.append(minimap);
	return minimap;
}

function render() {
	const container = ensureContainer();
	if (!rail) return;

	const comments = [...document.querySelectorAll('.commentarea .thing.comment')].filter(c => c instanceof HTMLElement);
	const mode = module.options.colourMode.value;

	// Every read first, then every write.
	//
	// This used to read `getBoundingClientRect()` and append a stripe in the same
	// loop, so each iteration's read forced a synchronous reflow against the
	// previous append. On a two-thousand-comment thread that is two thousand
	// forced reflows, repeated on every "load more comments" batch and every
	// filter toggle, because the rail is rebuilt from scratch 200ms after any
	// mutation anywhere in `.commentarea`.
	const docHeight = measureDocHeight();
	const measured = comments.map(c => {
		const rect = c.getBoundingClientRect();
		return {
			comment: c,
			top: rect.top + window.scrollY,
			height: Math.max(2, rect.height),
			depth: getCommentDepth(c),
			score: getCommentScore(c),
		};
	});

	// Built off-document and attached once, so the writes cost one layout between
	// them rather than one each.
	const fragment = document.createDocumentFragment();
	for (const { comment, top, height, depth, score } of measured) {
		const stripe = document.createElement('button');
		stripe.type = 'button';
		stripe.className = 'rsm-thread-minimap-stripe';
		stripe.style.top = `${(top / docHeight) * 100}%`;
		stripe.style.height = `${(height / docHeight) * 100}%`;
		// The property, not the `background` shorthand. The stylesheet reads
		// `var(--minimap-stripe-color, ...)`, and assigning `background` directly
		// overwrote that declaration outright - so the token it named was never
		// defined by anything, and the fallback was the only value that ever
		// applied.
		stripe.style.setProperty('--minimap-stripe-color', mode === 'score' ? scoreColor(score) : depthColor(depth));
		const label = depth ? `Depth ${depth} · score ${score}` : `Top-level · score ${score}`;
		stripe.title = label;
		// A stripe's only content is its colour and position, so `title` is the whole
		// of its name — and a tooltip is not one. Without this the minimap is a column
		// of identical unnamed buttons.
		stripe.setAttribute('aria-label', label);
		stripe.dataset.fullname = comment.dataset.fullname || '';
		fragment.append(stripe);
	}

	rail.textContent = '';
	rail.append(fragment);

	updateViewport();
	return container;
}

// The document height, cached.
//
// `updateViewport` ran on every scroll event and read `scrollHeight` each time,
// which is a layout read for a value that cannot change during a scroll. It is
// re-measured whenever the rail is rebuilt or the window resizes, which is when
// it actually can.
let cachedDocHeight = 1;

function measureDocHeight(): number {
	cachedDocHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
	return cachedDocHeight;
}

function updateViewport() {
	if (!viewport) return;
	const docHeight = cachedDocHeight;
	const viewportPct = (window.innerHeight / docHeight) * 100;
	const topPct = (window.scrollY / docHeight) * 100;
	viewport.style.top = `${topPct}%`;
	viewport.style.height = `${viewportPct}%`;
}

// Frame-throttled: a scroll fires far more often than the display refreshes, and
// the handler only moves one element.
let viewportFrame = 0;
function frameThrottledViewport() {
	if (viewportFrame) return;
	viewportFrame = requestAnimationFrame(() => {
		viewportFrame = 0;
		updateViewport();
	});
}

function scheduleRender() {
	if (renderTimer) clearTimeout(renderTimer);
	renderTimer = setTimeout(() => { render(); }, 200);
}

let mutationObserver: ?MutationObserver = null;

module.contentStart = () => {
	if (!document.querySelector('.commentarea')) return;
	render();

	// One listener on the rail rather than one per stripe. The stripes are rebuilt
	// on every mutation in the comment area, so per-stripe listeners were being
	// created and thrown away by the thousand.
	if (rail) {
		rail.addEventListener('click', (event: Event) => {
			const stripe = event.target instanceof Element ? event.target.closest('.rsm-thread-minimap-stripe') : null;
			if (!(stripe instanceof HTMLElement)) return;
			const fullname = stripe.dataset.fullname;
			if (!fullname) return;
			const comment = document.querySelector(`.commentarea .thing.comment[data-fullname="${CSS.escape(fullname)}"]`);
			if (comment) comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	}

	window.addEventListener('scroll', frameThrottledViewport, { passive: true });
	window.addEventListener('resize', scheduleRender, { passive: true });
	mutationObserver = new MutationObserver(scheduleRender);
	const target = document.querySelector('.commentarea');
	if (target) mutationObserver.observe(target, { childList: true, subtree: true });
};
