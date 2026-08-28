/* @flow */

// Current Reddit (Web3X/Shreddit) keeps useful post and comment metadata on
// custom-element attributes, while visible content remains in light-DOM slots.
// Normalise that stable surface into the legacy Thing vocabulary so the existing
// watcher and module system can operate on both renderers.

export const SHREDDIT_THING_SELECTOR = 'shreddit-post, shreddit-comment';
export const SHREDDIT_COMPAT_ATTR = 'data-res-shreddit-compat';
// One attribute, one `<style>` per registered owner. It was
// `data-res-shreddit-classic-style` while the classic layout was the only thing
// that ever needed to reach inside a shadow root; the value now names the owner
// so a second caller cannot clobber the first.
export const SHREDDIT_SHADOW_STYLE_ATTR = 'data-res-shreddit-shadow-style';

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

const SHREDDIT_PARTS = [
	{ selector: '.action-row, .shreddit-post-container', names: ['rsm-action-row'] },
	{ selector: '.shreddit-post-container > span:has(shreddit-vote-animations)', names: ['rsm-vote-cluster'] },
	{ selector: '.rpl-vote-button-group', names: ['rsm-vote-group'] },
	{
		selector: '[data-action-bar-action="upvote"], [data-action-bar-action="downvote"]',
		names: ['rsm-vote-button'],
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
	},
	{
		selector: '[data-action-bar-action]:not([data-action-bar-action="upvote"]):not([data-action-bar-action="downvote"])',
		names: ['rsm-action-control'],
	},
	{ selector: '[data-action-bar-action] svg[icon-name]', names: ['rsm-action-icon'] },
];

function addPart(element: Element, name: string): void {
	const names = (element.getAttribute('part') || '').split(/\s+/).filter(Boolean);
	if (!names.includes(name)) names.push(name);
	element.setAttribute('part', names.join(' '));
}

function exposeShadowParts(shadow: ShadowRoot): void {
	for (const { selector, names } of SHREDDIT_PARTS) {
		for (const element of shadow.querySelectorAll(selector)) {
			for (const name of names) addPart(element, name);
		}
	}

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

const shadowStyles: Map<string, ShadowStyle> = new Map([
	['classic', { css: CLASSIC_POST_SHADOW_CSS, match: 'shreddit-post' }],
]);

// Returns false only when there is a stylesheet for this host and its shadow root
// has not attached yet — which is the caller's cue to retry.
function installShadowStyles(host: HTMLElement): boolean {
	const shadow = host.shadowRoot;
	if (!shadow) return false;
	exposeShadowParts(shadow);

	// A host can need exposed parts without an injected stylesheet. Once its
	// root is prepared there is nothing else to wait for.
	let applicable = false;
	for (const [, { match }] of shadowStyles) {
		if (host.matches(match)) { applicable = true; break; }
	}
	if (!applicable) return true;

	for (const [key, { css, match }] of shadowStyles) {
		if (!host.matches(match)) continue;
		const selector = `style[${SHREDDIT_SHADOW_STYLE_ATTR}="${key}"]`;
		let style = shadow.querySelector(selector);
		if (!style) {
			style = document.createElement('style');
			style.setAttribute(SHREDDIT_SHADOW_STYLE_ATTR, key);
			shadow.append(style);
		}
		// Assigned rather than appended, so re-preparing a streamed host cannot
		// duplicate rules and a module that re-registers replaces its own sheet.
		if (style.textContent !== css) style.textContent = css;
	}
	return true;
}

// Add a stylesheet to every Shreddit host's shadow root, now and as they stream
// in. A module registering after the first paint has to reach the hosts already
// on the page — `prepareShredditThing` only ever sees the ones that arrive next,
// and on a warm SPA navigation that can be none of them.
export function registerShadowStyle(key: string, css: string, match: string = SHREDDIT_THING_SELECTOR): void {
	shadowStyles.set(key, { css, match });
	for (const host of document.querySelectorAll(SHREDDIT_THING_SELECTOR)) {
		// `WhenReady`, not the bare install: a module can register its sheet while
		// the hosts already on the page are still waiting to hydrate, which is the
		// same gap the streamed path has to cover.
		if (host instanceof HTMLElement) installShadowStylesWhenReady(host);
	}
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
let shadowSweepTimer: TimeoutID | null = null;
let shadowSweepIndex = 0;

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
		// Detached, out of time, or done — all three stop the wait. `contains`
		// rather than `isConnected`, which flow's DOM lib does not declare.
		if (!document.documentElement.contains(host) || now > deadline || installShadowStyles(host)) pendingShadowHosts.delete(host);
	}
	if (pendingShadowHosts.size) scheduleShadowSweep();
	else shadowSweepIndex = 0;
}

function installShadowStylesWhenReady(host: HTMLElement): void {
	if (installShadowStyles(host)) {
		pendingShadowHosts.delete(host);
		return;
	}
	if (!pendingShadowHosts.has(host)) {
		pendingShadowHosts.set(host, Date.now() + SHADOW_WAIT_MS);
		// A host that just arrived deserves the fast cadence again, even if the
		// sweep had already backed off waiting for something else.
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

function firstSubredditLink(element: HTMLElement): ?HTMLAnchorElement {
	const link = element.querySelector('a[href^="/r/"], a[href*="reddit.com/r/"]');
	return link instanceof HTMLAnchorElement ? link : undefined;
}

function preparePost(post: HTMLElement): void {
	installShadowStylesWhenReady(post);
	post.classList.add('thing', 'link');
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

	const title = post.querySelector('a[slot="title"], [slot="title"] a');
	if (title instanceof HTMLElement) title.classList.add('title');
	const author = firstProfileLink(post);
	if (author) author.classList.add('author');
	const creditBar = post.querySelector('[slot="credit-bar"]');
	if (creditBar instanceof HTMLElement) creditBar.classList.add('tagline');
	const subreddit = firstSubredditLink(post);
	if (subreddit) subreddit.classList.add('subreddit');
	const flair = post.querySelector('[slot="post-flair"]');
	if (flair instanceof HTMLElement) flair.classList.add('linkflairlabel');
	const body = post.querySelector('[slot="text-body"]');
	if (body instanceof HTMLElement) body.classList.add('md');
}

function prepareComment(comment: HTMLElement): void {
	// Comments carry their own shadow root with their own vote controls, so any
	// sheet registered for them has to be installed here too. The classic layout
	// is not one of them — it declares itself post-only.
	installShadowStylesWhenReady(comment);
	comment.classList.add('thing', 'comment');
	copyAttribute(comment, 'thingid', 'data-fullname');
	copyAttribute(comment, 'author', 'data-author');
	copyAttribute(comment, 'score', 'data-score');
	copyAttribute(comment, 'permalink', 'data-permalink');

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

	const details = comment.querySelector(':scope > details');
	comment.classList.toggle('collapsed', details instanceof HTMLDetailsElement && !details.open);
}

export function prepareShredditThing(element: HTMLElement): boolean {
	const tag = element.tagName.toLowerCase();
	if (tag === 'shreddit-post') preparePost(element);
	else if (tag === 'shreddit-comment') prepareComment(element);
	else return false;
	element.setAttribute(SHREDDIT_COMPAT_ATTR, '');
	return true;
}

export function prepareShredditTree(root: ParentNode): HTMLElement[] {
	const found = [];
	if (root instanceof HTMLElement && root.matches(SHREDDIT_THING_SELECTOR)) found.push(root);
	for (const element of root.querySelectorAll(SHREDDIT_THING_SELECTOR)) {
		if (element instanceof HTMLElement) found.push(element);
	}
	for (const element of found) prepareShredditThing(element);
	return found;
}
