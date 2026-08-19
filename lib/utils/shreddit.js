/* @flow */

// Current Reddit (Web3X/Shreddit) keeps useful post and comment metadata on
// custom-element attributes, while visible content remains in light-DOM slots.
// Normalise that stable surface into the legacy Thing vocabulary so the existing
// watcher and module system can operate on both renderers.

export const SHREDDIT_THING_SELECTOR = 'shreddit-post, shreddit-comment';
export const SHREDDIT_COMPAT_ATTR = 'data-res-shreddit-compat';

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
