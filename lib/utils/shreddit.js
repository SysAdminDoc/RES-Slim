/* @flow */

// Current Reddit (Web3X/Shreddit) keeps useful post and comment metadata on
// custom-element attributes, while visible content remains in light-DOM slots.
// Normalise that stable surface into the legacy Thing vocabulary so the existing
// watcher and module system can operate on both renderers.

import { frameThrottle } from './async';

export const SHREDDIT_THING_SELECTOR = 'shreddit-post, shreddit-comment';
export const SHREDDIT_COMPAT_ATTR = 'data-res-shreddit-compat';
// One attribute, one `<style>` per registered owner. It was
// `data-res-shreddit-classic-style` while the classic layout was the only thing
// that ever needed to reach inside a shadow root; the value now names the owner
// so a second caller cannot clobber the first.
export const SHREDDIT_SHADOW_STYLE_ATTR = 'data-res-shreddit-shadow-style';

// Reddit's current discussion controls are separate custom elements nested
// below a comment rather than part of the `shreddit-comment` shadow root. They
// still need the same bounded late-shadow handling as posts: server-rendered
// hosts can attach their roots well after the comment itself was prepared.
const SHREDDIT_AUX_SHADOW_SELECTOR = [
	'shreddit-comment-action-row',
	'award-button',
	'shreddit-overflow-menu',
	'faceplate-textarea-input',
	'comment-composer-host',
	'shreddit-comments-sort-dropdown',
	'shreddit-sort-dropdown',
	'pdp-comment-search-input',
	// The header search pill and the community Join button both paint inside
	// their own roots. Join is two roots deep: `shreddit-subreddit-header-buttons`
	// holds `shreddit-join-button`, which holds the real control, so the sweep
	// below has to look inside a prepared root for further hosts.
	'reddit-search-large',
	'faceplate-search-input',
	'shreddit-subreddit-header-buttons',
	'shreddit-subreddit-header',
	'shreddit-join-button',
	// Community highlights: the rail and each card keep their box inside a root.
	'shreddit-gallery-carousel',
	'community-highlight-card',
].join(', ');
const SHREDDIT_SHADOW_HOST_SELECTOR = `${SHREDDIT_THING_SELECTOR}, ${SHREDDIT_AUX_SHADOW_SELECTOR}`;

// Shreddit's vote and action controls live inside each post's open shadow root,
// so document CSS can only reach the stable elements exposed as parts. It still
// cannot move them into old Reddit's narrow left vote rail. Inject one gated
// geometry stylesheet into that root, while the document sheet owns paint and
// icon sizing through the parts assigned below.
//
// The gate is the layout, not the palette. This was `--classic.--refined` until
// v0.45.0, which meant the ten dark palettes got no vote rail inside the shadow
// root at all — the one part of the page document CSS cannot reach, so the
// omission was invisible to every stylesheet-level contract. Colours come from
// the `--rsm-th-*` tokens, which inherit across the shadow boundary; the literal
// after each comma is the Classic value, kept as a fallback for the case where a
// post upgrades before the palette class lands on `<html>`.
const CLASSIC_POST_SHADOW_CSS = `
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row,
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container {
	position: absolute !important;
	inset: 47px 6px auto 0 !important;
	display: flex !important;
	align-items: center !important;
	min-height: 16px !important;
	height: 16px !important;
	margin: 0 !important;
	padding: 0 0 0 128px !important;
	gap: 7px !important;
	overflow: visible !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote'],
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote'] {
	position: absolute !important;
	left: 10px !important;
	width: 24px !important;
	height: 18px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	padding: 0 !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote'] { top: -42px !important; }
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote'] { top: -8px !important; }

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > span:not([class]),
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) {
	position: absolute !important;
	left: 0 !important;
	top: -44px !important;
	display: flex !important;
	flex-direction: column !important;
	align-items: center !important;
	justify-content: center !important;
	width: 44px !important;
	height: 54px !important;
	margin: 0 !important;
	padding: 0 !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) .rpl-vote-button-group {
	display: flex !important;
	flex-direction: column !important;
	align-items: center !important;
	justify-content: center !important;
	gap: 0 !important;
	width: 44px !important;
	height: 54px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	padding: 0 !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(button, [role='button']) {
	display: flex !important;
	width: 24px !important;
	height: 18px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	margin: 0 !important;
	padding: 0 !important;
	align-items: center !important;
	justify-content: center !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action] svg[icon-name] {
	display: block !important;
	flex: none !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > button[aria-pressed='false'] .vote-icon-outline,
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > button[aria-pressed='true'] .vote-icon-fill {
	display: flex !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > button[aria-pressed='false'] .vote-icon-fill,
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > button[aria-pressed='true'] .vote-icon-outline {
	display: none !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(span, faceplate-number):not(:has(button)) {
	display: block !important;
	min-width: 30px !important;
	height: 14px !important;
	margin: 0 !important;
	padding: 0 !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action]:not([data-action-bar-action='upvote']):not([data-action-bar-action='downvote']) {
	display: inline-flex !important;
	align-items: center !important;
	gap: 2px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	height: 16px !important;
	padding: 0 2px !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) shreddit-post-share-button::part(share-button) {
	display: inline-flex !important;
	align-items: center !important;
	gap: 2px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	height: 16px !important;
	padding: 0 2px !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row,
:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container {
	display: flex !important;
	align-items: center !important;
	min-height: 18px !important;
	margin: 3px 0 0 !important;
	padding: 0 !important;
	gap: 7px !important;
	overflow: visible !important;
}
`;

// `hosts` is which custom elements a rule runs inside.
//
// The floor is mechanical: a part name exists to be reached by a
// `<host>::part(name)` rule in `lib/css/`, and that rule names its host, so
// every host the stylesheets paint has to appear on every entry carrying that
// name. The contract in `tests/unit/shreddit-shadow-cost-contract.test.mjs`
// reads the stylesheets and fails naming the entry when one is missing.
//
// Above that floor the lists are a judgement, and are deliberately wider than
// the CSS in about a dozen places -- a comment's own score, the composer under
// both of its host tags, the sort dropdown under both of its. Wider costs a
// query and loses nothing; narrower loses paint, which is why the check runs in
// only one direction.
//
// Two names, `rsm-comment-search-form` and `rsm-comment-count`, have no
// stylesheet rule at all. Their selectors are anchored to their own component
// (`#pdp-comment-search-form`, `[name="comments-action-button"]`), so they are
// scoped from that rather than from the CSS, and the contract has nothing to say
// about them until something paints them.
//
// The point of splitting at all is frequency, not per-call cost. A 500-comment
// thread carries one of these roots per action row, award button and overflow
// menu, and each re-ran all twenty-six selectors -- several with `:has()` --
// every time Reddit rerendered anything inside it. An action row now runs nine.
const SHREDDIT_PARTS = [
	{ selector: '.action-row, .shreddit-post-container', names: ['rsm-action-row'], hosts: ['shreddit-post'] },
	{ selector: '.shreddit-post-container > span:has(shreddit-vote-animations)', names: ['rsm-vote-cluster'], hosts: ['shreddit-post'] },
	{ selector: '.rpl-vote-button-group', names: ['rsm-vote-group'], hosts: ['shreddit-post', 'shreddit-comment-action-row'] },
	{
		selector: [
			'[data-action-bar-action="upvote"]',
			'[data-action-bar-action="downvote"]',
			'.rpl-vote-button-group > button[upvote]',
			'.rpl-vote-button-group > button[downvote]',
		].join(', '),
		names: ['rsm-vote-button'],
		hosts: ['shreddit-post', 'shreddit-comment-action-row'],
	},
	{
		selector: [
			'.rpl-vote-button-group > span:not(:has(button))',
			'.rpl-vote-button-group > faceplate-number:not(:has(button))',
			'[data-testid="comment-sub-header"] faceplate-number',
			'[data-testid="comment-sub-header"] [data-testid="comment-score"]',
			'[data-testid="comment-action-row"] faceplate-number',
			'[data-testid="comment-action-row"] [data-testid="comment-score"]',
		].join(', '),
		names: ['rsm-vote-score', 'rsm-score'],
		hosts: ['shreddit-post', 'shreddit-comment', 'shreddit-comment-action-row'],
	},
	{
		selector: '[data-action-bar-action]:not([data-action-bar-action="upvote"]):not([data-action-bar-action="downvote"])',
		names: ['rsm-action-control'],
		hosts: ['shreddit-post'],
	},
	{
		selector: '[data-action-bar-action] svg[icon-name], .rpl-vote-button-group svg[icon-name]',
		names: ['rsm-action-icon'],
		hosts: ['shreddit-post', 'shreddit-comment-action-row'],
	},
	{ selector: '.toolbar-container', names: ['rsm-comment-toolbar'], hosts: ['shreddit-comments-sort-dropdown'] },
	{ selector: '.outer-container', names: ['rsm-comment-toolbar-shell'], hosts: ['shreddit-comments-sort-dropdown'] },
	{ selector: '#comment-sort-button', names: ['rsm-comment-sort-button'], hosts: ['shreddit-sort-dropdown', 'shreddit-comments-sort-dropdown'] },
	{ selector: '#comment-sort-button svg[icon-name]', names: ['rsm-comment-sort-icon'], hosts: ['shreddit-sort-dropdown', 'shreddit-comments-sort-dropdown'] },
	{
		selector: '#expand-pdp-comment-search-button, #cancel-pdp-comment-search-button',
		names: ['rsm-comment-search-button'],
		hosts: ['pdp-comment-search-input'],
	},
	{ selector: '#expand-pdp-comment-search-button svg[icon-name]', names: ['rsm-comment-search-icon'], hosts: ['pdp-comment-search-input'] },
	{ selector: '#pdp-comment-search-form', names: ['rsm-comment-search-form'], hosts: ['pdp-comment-search-input'] },
	{ selector: 'label', names: ['rsm-comment-composer-shell'], hosts: ['faceplate-textarea-input', 'comment-composer-host'] },
	{ selector: '.input-boundary-box', names: ['rsm-comment-composer-boundary'], hosts: ['faceplate-textarea-input', 'comment-composer-host'] },
	{ selector: '.input-container, .text-area-wrapper', names: ['rsm-comment-composer-container'], hosts: ['faceplate-textarea-input', 'comment-composer-host'] },
	{ selector: 'textarea', names: ['rsm-comment-composer-input'], hosts: ['faceplate-textarea-input', 'comment-composer-host'] },
	{ selector: '[data-award-button]', names: ['rsm-comment-action-button'], hosts: ['award-button', 'shreddit-comment-action-row', 'shreddit-overflow-menu'] },
	{ selector: '[data-award-icon]', names: ['rsm-award-icon'], hosts: ['award-button', 'shreddit-comment-action-row'] },
	{ selector: '.open-menu-btn', names: ['rsm-comment-action-button'], hosts: ['award-button', 'shreddit-comment-action-row', 'shreddit-overflow-menu'] },
	{ selector: '.open-menu-btn svg[icon-name]', names: ['rsm-overflow-icon'], hosts: ['shreddit-overflow-menu', 'shreddit-comment-action-row'] },
	{ selector: '.reddit-search-bar', names: ['rsm-header-search-bar'], hosts: ['reddit-search-large', 'faceplate-search-input'] },
	{ selector: 'faceplate-dropdown-menu button[aria-haspopup]', names: ['rsm-sort-button'], hosts: ['shreddit-sort-dropdown', 'shreddit-comments-sort-dropdown'] },
	{ selector: '[name="comments-action-button"] .rpl-cab--content', names: ['rsm-comment-count'], hosts: ['shreddit-post'] },
	{ selector: '[name="comments-action-button"] .rpl-cab--leading-icon > :first-child', names: ['rsm-comment-count-icon'], hosts: ['shreddit-post'] },
];

function addPart(element: Element, name: string): void {
	const names = (element.getAttribute('part') || '').split(/\s+/).filter(Boolean);
	if (!names.includes(name)) names.push(name);
	element.setAttribute('part', names.join(' '));
}

function exposeShadowParts(shadow: ShadowRoot, hostTag: string): void {
	for (const { selector, names, hosts } of SHREDDIT_PARTS) {
		if (hosts && !hosts.includes(hostTag)) continue;
		for (const element of shadow.querySelectorAll(selector)) {
			for (const name of names) addPart(element, name);
		}
	}

	if (hostTag !== 'shreddit-post') return;
	for (const share of shadow.querySelectorAll('shreddit-post-share-button')) {
		const mappings = (share.getAttribute('exportparts') || '').split(',').map(value => value.trim()).filter(Boolean);
		for (const mapping of [
			'share-button:rsm-share-button',
			'share-button-leading-icon:rsm-share-icon',
		]) {
			if (!mappings.includes(mapping)) mappings.push(mapping);
		}
		share.setAttribute('exportparts', mappings.join(', '));
	}
}

// Reddit replaces the contents of open roots during hydration and again during
// component rerenders. Replacement nodes do not inherit the part attributes
// from the nodes they displaced, so keep the stable paint hooks current for the
// lifetime of each root. Observing child changes only means adding a part cannot
// feed back into this observer.
const observedShadowRoots: WeakMap<ShadowRoot, MutationObserver> = new WeakMap();

// Deliberately no registry of live observers.
//
// A previous attempt at "teardown" held every observer in a Set so they could
// all be disconnected on the page signal. That made things strictly worse: the
// callback closes over its host, so a strong Set rooted every observed host and
// its whole shadow subtree for the life of the page, and a probe that prepared
// thirty action rows, removed them and forced collection found all thirty still
// alive. Held by nothing but the node it observes, an observer dies with the
// root it watches, which is the behaviour we want and the one the browser gives
// for free. The page signal added nothing on top of it either: it aborts on
// pagehide, when the document is being destroyed anyway.
//
// The prune below is what handles the case the browser cannot: a host removed
// from the page while its root keeps being written to.
function keepShadowPartsCurrent(host: HTMLElement, shadow: ShadowRoot): void {
	if (observedShadowRoots.has(shadow)) return;

	// Re-run the complete install, not only the part exposure. A Reddit component
	// rerender can replace the root's entire contents, including the registered
	// classic layout sheet.
	//
	// Throttled to a frame, because Reddit rerenders inside these roots in bursts
	// -- a hover, an overflow menu opening, a vote landing -- and every batch used
	// to pay for the whole install. What is *not* throttled is repairing a
	// stylesheet the rerender destroyed: a root replacement that takes the classic
	// layout sheet with it would otherwise paint a frame of Reddit's own vote rail
	// before ours came back, and a background tab gets no frames at all, so the
	// repair would wait until the reader looked at it.
	const observer = new MutationObserver(() => {
		if (!isAttached(host)) {
			observer.disconnect();
			return;
		}
		// Only the sheet, and only when one is actually missing. Running the whole
		// install here would put the per-batch cost the throttle exists to remove
		// straight back: twenty sheet-destroying batches inside one frame cost two
		// hundred and thirty selector runs on one root when this called
		// `installShadowStyles`. The parts can wait for the frame; the sheet is what
		// paints Reddit's own vote rail if it waits.
		if (styleWasLost(host, shadow)) applyShadowStyles(host, shadow);
		// The promise is answered rather than dropped: a throw inside a throttled
		// callback is otherwise an unhandled rejection with no observer to blame it
		// on.
		run().catch(error => { console.error('RES-Slim: could not keep shadow parts current', error); });
	});
	const run = frameThrottle(() => { installShadowStyles(host); });
	observer.observe(shadow, { childList: true, subtree: true });
	observedShadowRoots.set(shadow, observer);
}

// Whether a root that should be carrying one of our stylesheets has stopped.
//
// Only the node path can lose one: `adoptedStyleSheets` is a property of the
// root rather than of its children, so replacing the contents leaves an adopted
// sheet in place. A root that never needed a sheet is never repaired.
function styleWasLost(host: HTMLElement, shadow: ShadowRoot): boolean {
	const adopted = (shadow: any).adoptedStyleSheets;
	for (const [key, { css, match }] of shadowStyles) {
		if (!host.matches(match)) continue;
		const sheet = constructedShadowStyles.get(key);
		if (sheet && Array.isArray(adopted) && adopted.includes(sheet)) continue;
		const node = shadow.querySelector(`style[${SHREDDIT_SHADOW_STYLE_ATTR}="${key}"]`);
		// Emptied counts as lost. A node that survives with its rules stripped is
		// the same to the reader as one that is gone.
		if (!node || node.textContent !== css) return true;
	}
	return false;
}

// Every stylesheet that has to live inside a Shreddit host's open shadow root,
// keyed by owner. Document CSS can paint explicitly exposed parts, but structural
// descendant selectors still need this route. `karmaHide` made it a second
// caller, which is what turned the single hardcoded sheet into a registry.
//
// `match` is the host selector the sheet applies to. The classic layout is
// post-only: its rules name `.action-row` and `[data-action-bar-action]`, both
// of which also exist inside a comment's shadow root, so applying it there would
// silently restyle comment controls that nobody asked to move.
type ShadowStyle = {| css: string, match: string |};

// Old Reddit's arrow glyphs, text action links, and the thread page's vote rail,
// measured against live current Reddit on 2026-09-02. A second sheet rather than
// edits to the first: both are `!important`, so the later one wins ties, and the
// score colour below is deliberately *not* important so a document `::part`
// rule (vote enhancements) still outranks it. The arrow is the button's own
// `::before` cut with a clip-path; Reddit's SVG pair is hidden, not removed, so
// the control keeps its listeners, labels and pressed state.
//
// The arrow and the score read `--rsm-vote-ink*`, which `_pageTheme.scss`
// defines once as old Reddit's own literals and Classic restates as readable
// equivalents: on a white row #c6c6c6 measures 1.71:1, the voted orange 2.30 and
// the periwinkle 2.65, while all three are 8:1 and up on the ten dark palettes.
// Under their own prefix rather than `--rsm-th-`, which this sheet must not read
// by contract - the palette's paint tokens belong to the document sheet's
// `::part` rules, and these three paint a pseudo-element `::part` cannot reach.
const CLASSIC_POST_FIDELITY_CSS = `
/* \`:is\` and the redundant \`[class]\`/\`[icon-name]\` are for specificity: the
   first sheet shows the outline SVG at (0,2,1) and the pressed-state span at
   (0,3,1), and both must lose to these. */
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group :is(button, [role='button']) svg[icon-name],
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group :is(button, [role='button']) svg,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='upvote'] svg[icon-name],
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='downvote'] svg[icon-name],
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :is(button, [role='button']) > :is(.vote-icon-outline, .vote-icon-fill)[class] {
	display: none !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(button, [role='button'])::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='upvote']::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='downvote']::before {
	content: '';
	display: block;
	flex: none;
	width: 15px;
	height: 14px;
	background: var(--rsm-vote-ink);
	clip-path: polygon(50% 0, 100% 50%, 70% 50%, 70% 100%, 30% 100%, 30% 50%, 0 50%);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(button, [role='button']):last-of-type::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > [downvote]::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='downvote']::before {
	clip-path: polygon(50% 100%, 100% 50%, 70% 50%, 70% 0, 30% 0, 30% 50%, 0 50%);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(button, [role='button']):first-of-type[aria-pressed='true']::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > [upvote][aria-pressed='true']::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='upvote'][aria-pressed='true']::before {
	background: var(--rsm-vote-ink-up);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(button, [role='button']):last-of-type[aria-pressed='true']::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > [downvote][aria-pressed='true']::before,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='downvote'][aria-pressed='true']::before {
	background: var(--rsm-vote-ink-down);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(span, faceplate-number):not(:has(button)) {
	color: var(--rsm-vote-ink);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group:has(> :where(button, [role='button']):first-of-type[aria-pressed='true']) > :where(span, faceplate-number):not(:has(button)) {
	color: var(--rsm-vote-ink-up);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group:has(> :where(button, [role='button']):last-of-type[aria-pressed='true']) > :where(span, faceplate-number):not(:has(button)) {
	color: var(--rsm-vote-ink-down);
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [name='comments-action-button'] .rpl-cab--leading-icon > :first-child,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='comments'] svg[icon-name],
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='share'] svg[icon-name],
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='comments'] svg,
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action='share'] svg {
	display: none !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [name='comments-action-button'] .rpl-cab--content::after {
	content: ' comments';
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [name='comments-action-button'] .rpl-cab--content:has(faceplate-number[number='1'])::after {
	content: ' comment';
}

/* 24px hit boxes behind the 16px line, for the target-size floor. */
:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action]:not([data-action-bar-action='upvote']):not([data-action-bar-action='downvote']),
:host-context(html.res-pageTheme.res-pageTheme--refined) [name='comments-action-button'],
:host-context(html.res-pageTheme.res-pageTheme--refined) shreddit-post-share-button::part(share-button) {
	box-sizing: border-box !important;
	min-height: 24px !important;
	height: 24px !important;
	margin: -4px 0 !important;
	gap: 0 !important;
	text-decoration: none !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote'],
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote'] {
	display: flex !important;
	align-items: center !important;
	justify-content: center !important;
}

/* Thread page: the vote rail sits at the top-left of the post, and the action
   links stay in flow below the content, which is old Reddit's link row. */
:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row,
:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container {
	position: static !important;
	min-height: 16px !important;
	height: 18px !important;
	margin: 4px 0 0 !important;
	padding: 0 !important;
	gap: 7px !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > span:not([class]),
:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) {
	position: absolute !important;
	left: 0 !important;
	top: 4px !important;
	display: flex !important;
	flex-direction: column !important;
	align-items: center !important;
	justify-content: center !important;
	width: 44px !important;
	height: 54px !important;
	margin: 0 !important;
	padding: 0 !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) .rpl-vote-button-group {
	display: flex !important;
	flex-direction: column !important;
	align-items: center !important;
	justify-content: center !important;
	gap: 0 !important;
	width: 44px !important;
	height: 54px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	padding: 0 !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(button, [role='button']) {
	display: flex !important;
	width: 24px !important;
	height: 18px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	margin: 0 !important;
	padding: 0 !important;
	align-items: center !important;
	justify-content: center !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .rpl-vote-button-group > :where(span, faceplate-number):not(:has(button)) {
	display: block !important;
	min-width: 30px !important;
	height: 14px !important;
	margin: 0 !important;
	padding: 0 !important;
}
`;

// Old Reddit's "+ subscribe" is a small blue pill with bold white text. Reddit's
// Join control is two roots deep and paints from the strong-content token, which
// the palette maps to black. This sheet reaches the real control inside
// `shreddit-join-button` once the nested sweep has found it.
const CLASSIC_JOIN_SHADOW_CSS = `
:host-context(html.res-pageTheme.res-pageTheme--refined) :where(button, a) {
	min-width: 0 !important;
	min-height: 0 !important;
	height: 18px !important;
	margin: 0 !important;
	padding: 0 7px !important;
	/* Old reddit's subscribe blue is #5f99cf, which puts white 10px bold text at
	   3.02:1. Darkened until the label clears 4.5. */
	background: #2b6fb0 !important;
	border: 0 !important;
	border-radius: 3px !important;
	box-shadow: none !important;
	color: #fff !important;
	font: bold 10px/18px verdana, arial, helvetica, sans-serif !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) :where(button, a) > span {
	display: inline !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) svg {
	display: none !important;
}
`;

// Community highlights become one line of links. The rail's root is a
// horizontally scrolling flex list and each card's root is a bordered flex box
// with an 18px clamped title; both are flattened here, gated on the highlights
// host so the same gallery component inside a media post is untouched.
const CLASSIC_HIGHLIGHT_RAIL_SHADOW_CSS = `
:host-context(html.res-pageTheme.res-pageTheme--refined community-highlight-carousel) > div,
:host-context(html.res-pageTheme.res-pageTheme--refined community-highlight-carousel) #list {
	display: inline !important;
	overflow: visible !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined community-highlight-carousel) [role='button'] {
	display: none !important;
}
`;

const CLASSIC_HIGHLIGHT_CARD_SHADOW_CSS = `
:host-context(html.res-pageTheme.res-pageTheme--refined) .highlight-card,
:host-context(html.res-pageTheme.res-pageTheme--refined) .main-content,
:host-context(html.res-pageTheme.res-pageTheme--refined) .main-content > div:first-child,
:host-context(html.res-pageTheme.res-pageTheme--refined) #title {
	display: inline !important;
	height: auto !important;
	min-height: 0 !important;
	padding: 0 !important;
	overflow: visible !important;
	background: transparent !important;
	border: 0 !important;
	box-shadow: none !important;
	font: inherit !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .top-tags,
:host-context(html.res-pageTheme.res-pageTheme--refined) .upvotes,
:host-context(html.res-pageTheme.res-pageTheme--refined) .main-content > div:not(:first-child),
:host-context(html.res-pageTheme.res-pageTheme--refined) .hover-overlay {
	display: none !important;
}
`;

// The right rail's community card. Its name line is a 24px bold truncating
// block that clipped its own descenders once the rail went to 12px type, and
// the thread page's Join control lives inside it.
const CLASSIC_COMMUNITY_SHADOW_CSS = `
:host-context(html.res-pageTheme.res-pageTheme--refined) .header {
	padding: 0 !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .prefixedName,
:host-context(html.res-pageTheme.res-pageTheme--refined) #title {
	overflow: visible !important;
	font: bold 13px/18px verdana, arial, helvetica, sans-serif !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) #description,
:host-context(html.res-pageTheme.res-pageTheme--refined) .description {
	font: normal 12px/16px verdana, arial, helvetica, sans-serif !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) .banner {
	display: none !important;
}
`;

// The header search field. The pill is `faceplate-search-input`'s own
// `.label-container`: 40px, radius 9999px, painted from the secondary token,
// inside the bar the document already flattened. Gated on the header so the
// same input elsewhere (comment search) keeps its own treatment.
const CLASSIC_SEARCH_SHADOW_CSS = `
:host-context(html.res-pageTheme.res-pageTheme--refined reddit-header-large) {
	min-height: 0 !important;
	height: 26px !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined reddit-header-large) .label-container {
	min-height: 0 !important;
	height: 26px !important;
	padding: 0 6px !important;
	background: transparent !important;
	border: 0 !important;
	border-radius: 0 !important;
	box-shadow: none !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined reddit-header-large) textarea {
	font: 13px/18px verdana, arial, helvetica, sans-serif !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined reddit-header-large) .centered-placeholder {
	display: none !important;
}
`;

const shadowStyles: Map<string, ShadowStyle> = new Map([
	['classic', { css: CLASSIC_POST_SHADOW_CSS, match: 'shreddit-post' }],
	['classic-search', { css: CLASSIC_SEARCH_SHADOW_CSS, match: 'faceplate-search-input' }],
	['classic-community', { css: CLASSIC_COMMUNITY_SHADOW_CSS, match: 'shreddit-subreddit-header' }],
	['classic-fidelity', { css: CLASSIC_POST_FIDELITY_CSS, match: 'shreddit-post' }],
	['classic-join', { css: CLASSIC_JOIN_SHADOW_CSS, match: 'shreddit-join-button' }],
	['classic-highlight-rail', { css: CLASSIC_HIGHLIGHT_RAIL_SHADOW_CSS, match: 'shreddit-gallery-carousel' }],
	['classic-highlight-card', { css: CLASSIC_HIGHLIGHT_CARD_SHADOW_CSS, match: 'community-highlight-card' }],
]);

// One constructed stylesheet per key, adopted into every root that needs it.
//
// The `<style>` node below is a per-root copy: the same CSS text was parsed
// again for every prepared post and comment, which on a feed is dozens of parses
// of the same few kilobytes and dozens of nodes to keep in sync. A constructed
// sheet is parsed once and adopted by reference, and `replaceSync` on it updates
// every root that has it at once - which is what a module re-registering its
// sheet wants anyway.
//
// The fallback is not hypothetical. A constructed sheet belongs to the document
// it was made in, so a root in another document cannot adopt it, and the
// property is absent on older engines. Both cases end up on the style node, and
// `shadowStyleDelivery` records which path a page actually took so a test can
// assert on it rather than on the feature detection.
const constructedShadowStyles: Map<string, CSSStyleSheet> = new Map();
export const shadowStyleDelivery: {| adopted: number, styleNode: number |} = { adopted: 0, styleNode: 0 };

function constructedSheetFor(key: string, css: string): ?CSSStyleSheet {
	const existing = constructedShadowStyles.get(key);
	if (existing) return existing;
	try {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(css);
		constructedShadowStyles.set(key, sheet);
		return sheet;
	} catch (e) {
		// No constructable stylesheets here. Every root takes the node path.
		return null;
	}
}

// `true` when the root now carries this sheet, `false` when the caller has to
// fall back. Appends rather than assigns: reddit puts its own sheets in here.
function adoptShadowStyle(shadow: ShadowRoot, key: string, css: string): boolean {
	const adopted = (shadow: any).adoptedStyleSheets;
	if (!Array.isArray(adopted)) return false;
	const sheet = constructedSheetFor(key, css);
	if (!sheet) return false;
	try {
		if (!adopted.includes(sheet)) (shadow: any).adoptedStyleSheets = [...adopted, sheet];
		return true;
	} catch (e) {
		// Cross-realm: the sheet belongs to another document.
		return false;
	}
}

// Returns false only when there is a stylesheet for this host and its shadow root
// has not attached yet — which is the caller's cue to retry.
function installShadowStyles(host: HTMLElement): boolean {
	const shadow = host.shadowRoot;
	if (!shadow) return false;
	exposeShadowParts(shadow, host.localName);
	// Hosts nested inside this root are invisible to a document query, so this
	// is the only place that can find them. Bounded by tree depth: a nested host
	// sweeps its own root once it has one, never back up.
	for (const nested of shadow.querySelectorAll(SHREDDIT_AUX_SHADOW_SELECTOR)) {
		if (nested instanceof HTMLElement) installShadowStylesWhenReady(nested);
	}

	// A host can need exposed parts without an injected stylesheet. Once its
	// root is prepared there is nothing else to wait for.
	let applicable = false;
	for (const [, { match }] of shadowStyles) {
		if (host.matches(match)) { applicable = true; break; }
	}
	if (!applicable) {
		keepShadowPartsCurrent(host, shadow);
		return true;
	}

	applyShadowStyles(host, shadow);
	keepShadowPartsCurrent(host, shadow);
	return true;
}

// The stylesheet half on its own, so a rerender that destroyed a sheet can have
// it back in the same turn without re-running every part selector with it.
function applyShadowStyles(host: HTMLElement, shadow: ShadowRoot): void {
	for (const [key, { css, match }] of shadowStyles) {
		if (!host.matches(match)) continue;
		const selector = `style[${SHREDDIT_SHADOW_STYLE_ATTR}="${key}"]`;
		const existingNode = shadow.querySelector(selector);
		if (adoptShadowStyle(shadow, key, css)) {
			// A root that adopted the sheet must not also carry a node with the same
			// rules: a page can take the node path first - a root prepared before the
			// sheet could be constructed - and the node would then keep applying its
			// own copy of whatever the CSS used to be.
			if (existingNode) existingNode.remove();
			shadowStyleDelivery.adopted += 1;
			continue;
		}
		let style = existingNode;
		if (!style) {
			style = document.createElement('style');
			style.setAttribute(SHREDDIT_SHADOW_STYLE_ATTR, key);
			shadow.append(style);
		}
		// Assigned rather than appended, so re-preparing a streamed host cannot
		// duplicate rules and a module that re-registers replaces its own sheet.
		if (style.textContent !== css) style.textContent = css;
		shadowStyleDelivery.styleNode += 1;
	}
}

// Add a stylesheet to every Shreddit host's shadow root, now and as they stream
// in. A module registering after the first paint has to reach the hosts already
// on the page — `prepareShredditThing` only ever sees the ones that arrive next,
// and on a warm SPA navigation that can be none of them.
export function registerShadowStyle(key: string, css: string, match: string = SHREDDIT_THING_SELECTOR): void {
	shadowStyles.set(key, { css, match });
	// Every root that adopted this key is already pointing at this object, so
	// replacing its contents updates all of them without touching a single root.
	const constructed = constructedShadowStyles.get(key);
	if (constructed) {
		try {
			constructed.replaceSync(css);
		} catch (e) {
			constructedShadowStyles.delete(key);
		}
	}
	for (const host of document.querySelectorAll(SHREDDIT_SHADOW_HOST_SELECTOR)) {
		// `WhenReady`, not the bare install: a module can register its sheet while
		// the hosts already on the page are still waiting to hydrate, which is the
		// same gap the streamed path has to cover.
		if (host instanceof HTMLElement) installShadowStylesWhenReady(host);
	}
}

function prepareShredditShadowHosts(root: ParentNode): void {
	const found = [];
	if (root instanceof HTMLElement && root.matches(SHREDDIT_SHADOW_HOST_SELECTOR)) found.push(root);
	for (const element of root.querySelectorAll(SHREDDIT_SHADOW_HOST_SELECTOR)) {
		if (element instanceof HTMLElement) found.push(element);
	}
	for (const host of found) installShadowStylesWhenReady(host);
}

// A host can be observed in the interval between being parsed and its shadow
// root being attached, and on current Reddit that interval is the common case
// for the first screenful: reddit's server-rendered posts are in the document
// when the content script's first sweep runs, and they do not grow a root until
// its bundle hydrates them several hundred milliseconds later.
//
// This waited on `customElements.whenDefined(tagName)` and forced the upgrade
// with `customElements.upgrade(host)`. **Neither ran.** A Chrome content script's
// isolated world has `customElements === null` — `typeof` still answers
// `'object'`, so the guard above read as a real registry and returned instead.
// Measured on a live subreddit: `ce-typeof=object truthy=false` for every host
// that had to wait, no retry ever attempted, and the three server-rendered posts
// at the top of the feed kept reddit's native action bar while the streamed ones
// below them got the classic vote rail. Even had it been non-null, `whenDefined`
// on the isolated registry would never resolve for an element the page defines.
//
// There is no event for a shadow root attaching, so waiting is a poll. One
// shared sweep for all pending hosts rather than a timer chain each: a feed
// holds fifty of them, and they hydrate in one batch. The cadence starts at a
// frame and backs off, and each host carries a deadline so one that never grows
// a root cannot keep the sweep alive for the life of the page.
const SHADOW_SWEEP_DELAYS = [16, 32, 64, 125, 250, 500, 1000];
const SHADOW_WAIT_MS = 20000;

const pendingShadowHosts: Map<HTMLElement, number> = new Map();
// Hosts that used up their twenty seconds without ever attaching a root. Without
// this the wait was not bounded at all: an aux host that never hydrates in this
// context -- an un-upgraded `award-button`, a composer on a locked thread --
// was dropped at the deadline and then re-found by the next observer-driven
// sweep of its parent root, re-added with a fresh deadline, and the backoff
// reset to 16ms. Inside a root that keeps mutating that is a permanent
// sixteen-millisecond chain of whole-tree walks.
const expiredShadowHosts: WeakSet<HTMLElement> = new WeakSet();
let shadowSweepTimer: TimeoutID | null = null;

// `documentElement.contains` stops at a shadow boundary, so a host nested in
// another root read as detached and was dropped on the first sweep. `isConnected`
// crosses the boundary; flow 0.84's DOM lib does not declare it, hence the cast,
// and `contains` stays as the fallback for a runtime without it.
function isAttached(host: HTMLElement): boolean {
	const connected = (host: any).isConnected;
	if (typeof connected === 'boolean') return connected;
	return document.documentElement.contains(host);
}
let shadowSweepIndex = 0;

// The sweep's state, exported for the same reason `shadowStyleDelivery` is: the
// bound on the late-shadow wait is a property of this module that nothing else
// can see, and a contract that cannot see it can only assert the comment that
// claims the bound exists.
export function shadowSweepState(): {| pending: number, timerPending: boolean, backoffStep: number |} {
	return { pending: pendingShadowHosts.size, timerPending: shadowSweepTimer !== null, backoffStep: shadowSweepIndex };
}

function scheduleShadowSweep() {
	if (shadowSweepTimer !== null) return;
	const delay = SHADOW_SWEEP_DELAYS[Math.min(shadowSweepIndex, SHADOW_SWEEP_DELAYS.length - 1)];
	shadowSweepIndex++;
	shadowSweepTimer = setTimeout(sweepPendingShadowHosts, delay);
}

function sweepPendingShadowHosts() {
	shadowSweepTimer = null;
	const now = Date.now();
	for (const [host, deadline] of [...pendingShadowHosts]) {
		// Detached, out of time, or done — all three stop the wait.
		if (now > deadline) {
			expiredShadowHosts.add(host);
			pendingShadowHosts.delete(host);
			continue;
		}
		if (!isAttached(host) || installShadowStyles(host)) pendingShadowHosts.delete(host);
	}
	if (pendingShadowHosts.size) scheduleShadowSweep();
	else shadowSweepIndex = 0;
}

function installShadowStylesWhenReady(host: HTMLElement): void {
	if (installShadowStyles(host)) {
		pendingShadowHosts.delete(host);
		return;
	}
	// A host that used up its twenty seconds is not asked again. This is what
	// bounds the wait: without it, a host that never hydrates was dropped at its
	// deadline and re-found by the next rerender of the root it sits in, which
	// re-added it with a fresh deadline *and* reset the backoff below to 16ms.
	// Inside a root that keeps mutating that is a permanent chain of whole-tree
	// walks, which is the opposite of the bound the comment on SHADOW_WAIT_MS
	// claims.
	if (expiredShadowHosts.has(host)) return;
	if (!pendingShadowHosts.has(host)) {
		pendingShadowHosts.set(host, Date.now() + SHADOW_WAIT_MS);
		// A host that just arrived deserves the fast cadence again, even if the
		// sweep had already backed off waiting for something else. Inside the guard
		// on purpose: a host already waiting is re-found on every rerender of its
		// parent root, and letting those restart the backoff would pin the sweep at
		// its fastest step for as long as the parent keeps mutating.
		shadowSweepIndex = 0;
		if (shadowSweepTimer !== null) {
			clearTimeout(shadowSweepTimer);
			shadowSweepTimer = null;
		}
	}
	scheduleShadowSweep();
}

function copyAttribute(element: HTMLElement, source: string, target: string): void {
	const value = element.getAttribute(source);
	if (value !== null && value !== '') element.setAttribute(target, value);
}

function firstProfileLink(element: HTMLElement): ?HTMLAnchorElement {
	const links = element.querySelectorAll('a[href*="/user/"]');
	let fallback;
	for (const link of links) {
		if (!(link instanceof HTMLAnchorElement)) continue;
		if (!/\/user\/[^/]+\/?$/i.test(link.pathname)) continue;
		if ((link.textContent || '').trim()) return link;
		if (!fallback) fallback = link;
	}
	return fallback;
}

// Old Reddit's tagline is `submitted <time> by <author>`; Reddit's credit bar
// puts the time last. The stylesheet could reorder that with flex `order`, but
// a flex item is not inline text, and WCAG's target-size rule then measures
// the 14px author link as a bare control instead of a link in a sentence. So
// the timestamp moves to the front of its own row once, in the light DOM, and
// the tagline stays inline. Idempotent: a timestamp already first is left alone.
function hoistTimestamp(creditBar: HTMLElement): void {
	const timestamp = creditBar.querySelector('faceplate-timeago');
	if (!(timestamp instanceof HTMLElement)) return;
	const row = timestamp.parentElement;
	if (!row || row.firstElementChild === timestamp) return;
	row.prepend(timestamp);
}

function firstSubredditLink(element: HTMLElement): ?HTMLAnchorElement {
	const link = element.querySelector('a[href^="/r/"], a[href*="reddit.com/r/"]');
	return link instanceof HTMLAnchorElement ? link : undefined;
}

// The half that has to run again when reddit ticks a live score.
//
// Eight attribute copies and five class toggles, no `querySelector` and no shadow
// work. Everything below this is the expensive half, and re-running it on every
// attribute change is what made a hydrating feed prepare hundreds of times.
function refreshPost(post: HTMLElement): void {
	copyAttribute(post, 'id', 'data-fullname');
	copyAttribute(post, 'author', 'data-author');
	copyAttribute(post, 'subreddit-name', 'data-subreddit');
	copyAttribute(post, 'domain', 'data-domain');
	copyAttribute(post, 'score', 'data-score');
	copyAttribute(post, 'comment-count', 'data-comments-count');
	copyAttribute(post, 'permalink', 'data-permalink');
	copyAttribute(post, 'content-href', 'data-url');

	const postType = (post.getAttribute('post-type') || '').toLowerCase();
	const domain = (post.getAttribute('domain') || '').toLowerCase();
	post.classList.toggle('self', postType === 'text' || domain.startsWith('self.'));
	post.classList.toggle('over18', post.hasAttribute('nsfw') || post.hasAttribute('is-nsfw'));
	post.classList.toggle('spoiler', post.hasAttribute('spoiler') || post.hasAttribute('is-spoiler'));
	post.classList.toggle('locked', post.hasAttribute('locked') || post.hasAttribute('is-locked'));
	post.classList.toggle('promoted', post.hasAttribute('promoted') || post.getAttribute('data-promoted') === 'true');
}

function refreshComment(comment: HTMLElement): void {
	copyAttribute(comment, 'thingid', 'data-fullname');
	copyAttribute(comment, 'author', 'data-author');
	copyAttribute(comment, 'score', 'data-score');
	copyAttribute(comment, 'permalink', 'data-permalink');

	const details = comment.querySelector(':scope > details');
	const collapsedAttr = comment.getAttribute('collapsed');
	const collapsed = (collapsedAttr !== null && collapsedAttr !== 'false') ||
		(details instanceof HTMLDetailsElement && !details.open);
	comment.classList.toggle('collapsed', collapsed);
}

function preparePost(post: HTMLElement, shadowHostsPrepared: boolean): void {
	if (!shadowHostsPrepared) installShadowStylesWhenReady(post);
	post.classList.add('thing', 'link');
	refreshPost(post);

	const title = post.querySelector('a[slot="title"], [slot="title"] a');
	if (title instanceof HTMLElement) title.classList.add('title');
	const author = firstProfileLink(post);
	if (author) author.classList.add('author');
	const creditBar = post.querySelector('[slot="credit-bar"]');
	if (creditBar instanceof HTMLElement) {
		creditBar.classList.add('tagline');
		hoistTimestamp(creditBar);
	}
	// The credit bar's own community link first: the post's `full-post-link`
	// also starts with `/r/`, sits earlier in the DOM, and is invisible, so it
	// used to take the class and the tagline lost its "to r/name".
	const subreddit = (creditBar instanceof HTMLElement && firstSubredditLink(creditBar)) || firstSubredditLink(post);
	if (subreddit) subreddit.classList.add('subreddit');
	const flair = post.querySelector('[slot="post-flair"]');
	if (flair instanceof HTMLElement) flair.classList.add('linkflairlabel');
	const body = post.querySelector('[slot="text-body"]');
	if (body instanceof HTMLElement) body.classList.add('md');
	// Old Reddit prints `(domain)` after a link title. Reddit prints the whole
	// outbound URL on its own line, and CSS can only generate text from the
	// element's own attributes, so the post's domain is copied onto the link.
	const outbound = post.querySelector('a.post-link, [slot="title"] ~ * a[target="_blank"][rel~="nofollow"]');
	const domain = post.getAttribute('domain');
	if (outbound instanceof HTMLElement && domain) {
		outbound.classList.add('domain');
		outbound.setAttribute('data-rsm-domain', domain);
	}
}

function prepareComment(comment: HTMLElement, shadowHostsPrepared: boolean): void {
	// Comments carry their own shadow root with their own vote controls, so any
	// sheet registered for them has to be installed here too. The classic layout
	// is not one of them — it declares itself post-only.
	if (!shadowHostsPrepared) prepareShredditShadowHosts(comment);
	comment.classList.add('thing', 'comment');
	refreshComment(comment);

	const author = firstProfileLink(comment);
	if (author) author.classList.add('author');
	if (author && comment.querySelector('shreddit-comment-author-modifier-icon[op]')) author.classList.add('submitter');
	if (author && comment.querySelector('shreddit-comment-author-modifier-icon[distinguished-as="MODERATOR"]')) author.classList.add('moderator');
	if (author && comment.querySelector('shreddit-comment-author-modifier-icon[distinguished-as="ADMIN"]')) author.classList.add('admin');
	const meta = comment.querySelector('[slot="commentMeta"]');
	if (meta instanceof HTMLElement) meta.classList.add('tagline');
	const body = comment.querySelector('[slot="comment"]');
	if (body instanceof HTMLElement) body.classList.add('md', 'usertext-body');
	const actions = comment.querySelector('[slot="actionRow"]');
	if (actions instanceof HTMLElement) actions.classList.add('flat-list', 'buttons');
	const permalink = comment.querySelector('a[href*="/comment/"]');
	if (permalink instanceof HTMLElement) permalink.classList.add('bylink');
	const summary = comment.querySelector(':scope > details > summary');
	if (summary instanceof HTMLElement) summary.classList.add('expand');
}

export function prepareShredditThing(element: HTMLElement, shadowHostsPrepared: boolean = false): boolean {
	const tag = element.tagName.toLowerCase();
	if (tag === 'shreddit-post') preparePost(element, shadowHostsPrepared);
	else if (tag === 'shreddit-comment') prepareComment(element, shadowHostsPrepared);
	else return false;
	element.setAttribute(SHREDDIT_COMPAT_ATTR, '');
	return true;
}

// What an attribute change needs, and nothing else.
//
// Reddit ticks a post's live score as an attribute, so the observer fires for
// every post repeatedly while a feed hydrates and again on every vote. Routing
// that through the full pass redid eight to ten attribute copies, five class
// toggles, six to nine `querySelector` calls and the shadow-part exposure, per
// post, per tick.
//
// `SHREDDIT_COMPAT_ATTR` is what says the full pass has already happened. It was
// written and never read anywhere; this is the reader. An attribute change on a
// thing that has never been prepared still gets the full pass, because the cheap
// half alone would leave it undecorated.
export function refreshShredditThing(element: HTMLElement): boolean {
	if (!element.hasAttribute(SHREDDIT_COMPAT_ATTR)) return prepareShredditThing(element);

	const tag = element.tagName.toLowerCase();
	if (tag === 'shreddit-post') refreshPost(element);
	else if (tag === 'shreddit-comment') refreshComment(element);
	else return false;
	return true;
}

export function prepareShredditTree(root: ParentNode): HTMLElement[] {
	prepareShredditShadowHosts(root);
	const found = [];
	if (root instanceof HTMLElement && root.matches(SHREDDIT_THING_SELECTOR)) found.push(root);
	for (const element of root.querySelectorAll(SHREDDIT_THING_SELECTOR)) {
		if (element instanceof HTMLElement) found.push(element);
	}
	// The shared sweep above covered this whole subtree once. Passing that fact
	// down prevents every nested comment from rescanning all of its descendants,
	// which otherwise approaches quadratic work on deep threads.
	for (const element of found) prepareShredditThing(element, true);
	return found;
}
