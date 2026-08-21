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
module.description = 'Vertical heatmap of the current comment tree. Colour by depth, click to jump, viewport overlay shows position.';
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
		title: 'Colour mode',
		description: 'How each stripe is coloured.',
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
	rail.textContent = '';

	const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
	const comments = document.querySelectorAll('.commentarea .thing.comment');
	const mode = module.options.colourMode.value;

	for (const c of comments) {
		if (!(c instanceof HTMLElement)) continue;
		const rect = c.getBoundingClientRect();
		const top = rect.top + window.scrollY;
		const height = Math.max(2, rect.height);
		const stripe = document.createElement('button');
		stripe.type = 'button';
		stripe.className = 'rsm-thread-minimap-stripe';
		stripe.style.top = `${(top / docHeight) * 100}%`;
		stripe.style.height = `${(height / docHeight) * 100}%`;
		const depth = getCommentDepth(c);
		const score = getCommentScore(c);
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
		stripe.dataset.fullname = c.dataset.fullname || '';
		stripe.addEventListener('click', () => {
			c.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}, false);
		rail.append(stripe);
	}

	updateViewport();
	return container;
}

function updateViewport() {
	if (!viewport) return;
	const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
	const viewportPct = (window.innerHeight / docHeight) * 100;
	const topPct = (window.scrollY / docHeight) * 100;
	viewport.style.top = `${topPct}%`;
	viewport.style.height = `${viewportPct}%`;
}

function scheduleRender() {
	if (renderTimer) clearTimeout(renderTimer);
	renderTimer = setTimeout(() => { render(); }, 200);
}

let mutationObserver: ?MutationObserver = null;

module.contentStart = () => {
	if (!document.querySelector('.commentarea')) return;
	render();
	window.addEventListener('scroll', updateViewport, { passive: true });
	window.addEventListener('resize', scheduleRender, { passive: true });
	mutationObserver = new MutationObserver(scheduleRender);
	const target = document.querySelector('.commentarea');
	if (target) mutationObserver.observe(target, { childList: true, subtree: true });
};
