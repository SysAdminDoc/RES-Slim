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
// so document CSS can recolour them through inherited tokens but cannot move
// them into old Reddit's narrow left vote rail. Inject one gated stylesheet into
// that root. It contains CSS only, leaves the native elements and listeners in
// place, and becomes inert immediately when the refined layout is turned off.
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
	font: bold 10px/16px verdana, arial, helvetica, sans-serif !important;
	color: var(--rsm-th-muted, #666) !important;
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
	border: 0 !important;
	background: transparent !important;
	color: var(--rsm-th-muted, #aaa) !important;
	font-size: 0 !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote'] { top: -42px !important; }
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote'] { top: -8px !important; }

/* The deterministic fixture has text-only buttons; live Reddit supplies its own
 * icon elements. Use the bundled Batch icon font only for those direct fixture
 * buttons so the visual contract exercises real controls instead of blank rails. */
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote']::before,
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote']::before {
	display: block;
	color: var(--rsm-th-muted, #aaa);
	font: normal 12px/18px Batch;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote']::before { content: '\\F148'; }
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote']::before { content: '\\F149'; }

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row > span:not([class]),
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) {
	position: absolute !important;
	left: 0 !important;
	top: -45px !important;
	display: flex !important;
	flex-direction: column !important;
	align-items: center !important;
	justify-content: center !important;
	width: 44px !important;
	height: 54px !important;
	margin: 0 !important;
	padding: 0 !important;
	background: transparent !important;
	color: var(--rsm-th-txt, #c6c6c6) !important;
	font: bold 10px/14px verdana, arial, helvetica, sans-serif !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) .rpl-vote-button-group {
	display: flex !important;
	flex-direction: column !important;
	width: 44px !important;
	height: 54px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	padding: 0 !important;
	border: 0 !important;
	background: transparent !important;
	box-shadow: none !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action] {
	min-width: 0 !important;
	min-height: 0 !important;
	height: 16px !important;
	padding: 0 2px !important;
	border: 0 !important;
	border-radius: 0 !important;
	background: transparent !important;
	box-shadow: none !important;
	color: var(--rsm-th-muted, #666) !important;
	font: bold 10px/16px verdana, arial, helvetica, sans-serif !important;
}

:host-context(html.res-pageTheme.res-pageTheme--refined) [data-action-bar-action]:hover {
	color: var(--rsm-th-link, #369) !important;
	text-decoration: underline !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .action-row,
:host([view-context='CommentsPage']):host-context(html.res-pageTheme.res-pageTheme--refined) .shreddit-post-container {
	display: flex !important;
	align-items: center !important;
	min-height: 18px !important;
	margin: 3px 0 0 44px !important;
	padding: 0 !important;
	gap: 7px !important;
	overflow: visible !important;
}
`;

// Every stylesheet that has to live inside a Shreddit host's open shadow root,
// keyed by owner. Document CSS cannot reach in there at all, so this is the only
// route — and `karmaHide` made it a second caller, which is what turned the
// single hardcoded sheet into a registry.
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
	// Nothing registered for this host means nothing to wait for. Reporting "not
	// ready" here instead sent every unstyled host into a retry chain for a root
	// it was never going to need, which showed up as timer chains outliving the
	// work that started them.
	let applicable = false;
	for (const [, { match }] of shadowStyles) {
		if (host.matches(match)) { applicable = true; break; }
	}
	if (!applicable) return true;

	const shadow = host.shadowRoot;
	if (!shadow) return false;

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
		if (host instanceof HTMLElement) installShadowStyles(host);
	}
}

// A streamed host can be observed in the interval between being parsed and its
// shadow root being attached.
//
// This used to bail unless `customElements.get(tagName)` already answered, then
// retry exactly once after a frame. Both halves were wrong. Gating on `get()`
// meant a host seen before Reddit's bundle registered its definition was
// abandoned outright, and one frame is not a bound on when a root appears — that
// same assumption is the documented cause of failures in three other extensions,
// where a MutationObserver and three seconds of polling both missed it too.
//
// `whenDefined` resolves whether the definition has landed yet or not, and
// `upgrade()` then runs the constructor synchronously rather than waiting for the
// scheduler to get to it. The bounded retry covers the residue: a component that
// attaches its root a tick or two after construction.
const SHADOW_RETRY_DELAYS = [0, 16, 50, 150, 300];

function installShadowStylesWhenReady(host: HTMLElement, tagName: string): void {
	if (installShadowStyles(host)) return;
	if (typeof customElements === 'undefined' || !customElements) return;

	const attempt = () => {
		if (!document.documentElement.contains(host)) return true; // detached; stop
		// Forces the constructor now if the upgrade is merely pending. Throws if
		// the host is already upgraded on some engines, which is not a failure.
		try { customElements.upgrade(host); } catch (e) { /* already upgraded */ }
		return installShadowStyles(host);
	};

	customElements.whenDefined(tagName).then(() => {
		if (attempt()) return;
		// Bounded on purpose: a host that never grows a root must not leave a
		// timer chain running for the life of the page.
		let index = 0;
		const retry = () => {
			if (attempt() || index >= SHADOW_RETRY_DELAYS.length) return;
			setTimeout(retry, SHADOW_RETRY_DELAYS[index++]);
		};
		retry();
	}).catch(() => {
		// `whenDefined` rejects only on an invalid custom element name, which would
		// be a bug here rather than a page condition.
	});
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
	installShadowStylesWhenReady(post, 'shreddit-post');
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
	installShadowStylesWhenReady(comment, 'shreddit-comment');
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
