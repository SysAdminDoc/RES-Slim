/* @flow */

// Current Reddit (Web3X/Shreddit) keeps useful post and comment metadata on
// custom-element attributes, while visible content remains in light-DOM slots.
// Normalise that stable surface into the legacy Thing vocabulary so the existing
// watcher and module system can operate on both renderers.

export const SHREDDIT_THING_SELECTOR = 'shreddit-post, shreddit-comment';
export const SHREDDIT_COMPAT_ATTR = 'data-res-shreddit-compat';
export const SHREDDIT_CLASSIC_STYLE_ATTR = 'data-res-shreddit-classic-style';

// Shreddit's vote and action controls live inside each post's open shadow root,
// so document CSS can recolour them through inherited tokens but cannot move
// them into old Reddit's narrow left vote rail. Inject one gated stylesheet into
// that root. It contains CSS only, leaves the native elements and listeners in
// place, and becomes inert immediately when the Classic palette is not active.
const CLASSIC_POST_SHADOW_CSS = `
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row,
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .shreddit-post-container {
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

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote'],
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote'] {
	position: absolute !important;
	left: 10px !important;
	width: 24px !important;
	height: 18px !important;
	min-width: 0 !important;
	min-height: 0 !important;
	padding: 0 !important;
	border: 0 !important;
	background: transparent !important;
	color: #aaa !important;
	font-size: 0 !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote'] { top: -42px !important; }
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote'] { top: -8px !important; }

/* The deterministic fixture has text-only buttons; live Reddit supplies its own
 * icon elements. Use the bundled Batch icon font only for those direct fixture
 * buttons so the visual contract exercises real controls instead of blank rails. */
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote']::before,
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote']::before {
	display: block;
	color: #aaa;
	font: normal 12px/18px Batch;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='upvote']::before { content: '\\F148'; }
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > [data-action-bar-action='downvote']::before { content: '\\F149'; }

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row > span:not([class]),
:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) {
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
	color: #c6c6c6 !important;
	font: bold 10px/14px verdana, arial, helvetica, sans-serif !important;
}

:host(:not([view-context='CommentsPage'])):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .shreddit-post-container > span:has(shreddit-vote-animations) .rpl-vote-button-group {
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

:host-context(html.res-pageTheme--classic.res-pageTheme--refined) [data-action-bar-action] {
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

:host-context(html.res-pageTheme--classic.res-pageTheme--refined) [data-action-bar-action]:hover {
	color: #369 !important;
	text-decoration: underline !important;
}

:host([view-context='CommentsPage']):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .action-row,
:host([view-context='CommentsPage']):host-context(html.res-pageTheme--classic.res-pageTheme--refined) .shreddit-post-container {
	display: flex !important;
	align-items: center !important;
	min-height: 18px !important;
	margin: 3px 0 0 44px !important;
	padding: 0 !important;
	gap: 7px !important;
	overflow: visible !important;
}
`;

function installClassicShadowStyle(post: HTMLElement): boolean {
	const shadow = post.shadowRoot;
	if (!shadow) return false;
	if (shadow.querySelector(`style[${SHREDDIT_CLASSIC_STYLE_ATTR}]`)) return true;
	const style = document.createElement('style');
	style.setAttribute(SHREDDIT_CLASSIC_STYLE_ATTR, '');
	style.textContent = CLASSIC_POST_SHADOW_CSS;
	shadow.append(style);
	return true;
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
	if (!installClassicShadowStyle(post) && typeof customElements !== 'undefined' && customElements && customElements.get('shreddit-post')) {
		// A streamed host can be observed in the narrow interval between upgrade and
		// shadow attachment. One frame later its constructor has finished; do not
		// poll indefinitely or keep a detached post alive.
		requestAnimationFrame(() => {
			if (document.documentElement.contains(post)) installClassicShadowStyle(post);
		});
	}
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
