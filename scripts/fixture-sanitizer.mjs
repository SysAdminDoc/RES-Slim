// @noflow
/* eslint-disable import/no-nodejs-modules */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

export const OLD_REDDIT_XMLNS = 'http://www.w3.org/1999/xhtml';
export const FIXTURE_KIND = Object.freeze({
	frontpage: 'frontpage',
	thread: 'thread',
});

const PRIVATE_BODY_CLASSES = Object.freeze([
	'moderator',
	'modqueue-page',
	'messages-page',
	'gold-page',
	'saved-page',
	'sponsor-page',
]);

const REMOVE_SELECTORS = Object.freeze([
	'script',
	'noscript',
	'iframe',
	'object',
	'embed',
	'link[rel~="stylesheet"]',
	'link[rel~="preload"]',
	'link[rel~="prefetch"]',
	'link[rel~="dns-prefetch"]',
	'link[rel~="preconnect"]',
	'meta[http-equiv="set-cookie" i]',
	'input[name="uh" i]',
	'input[name="modhash" i]',
	'input[name="csrf_token" i]',
	'.modhash',
	'.message',
	'.message-parent',
	'#chat',
	'[id^="codex-browser-"]',
	'[id^="RES"]',
]);

const SAFE_DATA_ATTRIBUTES = new Set([
	'data-author',
	'data-comments-count',
	'data-domain',
	'data-fullname',
	'data-num-crossposts',
	'data-oc',
	'data-permalink',
	'data-promoted',
	'data-replies',
	'data-res-slim-ups',
	'data-score',
	'data-spoiler',
	'data-subreddit',
	'data-subreddit-prefixed',
	'data-url',
	'data-nsfw',
]);

const STATIC_STRUCTURAL_IDS = new Set([
	'header',
	'header-bottom-left',
	'header-bottom-right',
	'mail',
	'search',
	'siteTable',
	'sr-header-area',
	'sr-more-link',
]);

const NORMALIZED_THING_ID_PATTERN = /^thing_t(?:1_comment\d{6}|3_post\d{8})$/;

const TEXT_PLACEHOLDERS = Object.freeze({
	author: 'fixture_author',
	commentBody: 'Fixture comment body.',
	postTitle: 'Fixture post title',
	subreddit: 'fixture',
});

const SECRET_NAME_PATTERN = /(?:^|[-_:])(?:authorization|auth|bearer|cookie|csrf|modhash|passwd|password|secret|session|token|uh)(?:$|[-_:])/i;
const SECRET_VALUE_PATTERN = /(?:bearer\s+[a-z0-9._~-]+|(?:csrf|modhash|session|token)\s*[:=]\s*[^\s"'<>]+)/i;
const SAFE_TEXT_PATTERN = /^(?:[-|·•…π<>()\[\]{}:;,.!?+*/=&%$#@~_'"\s]*|\d+(?:\.\d+)?[kKmM]?|ago|all|best|by|comments?|controversial|downvote|edit|hide|hot|join|link|load more comments|mail|more|new|next|old|permalink|posts?|preferences|previous|report|reply|rising|save|search|settings|share|sorted by|submit|submitted|top|to|upvote|view more)$/i;

const INLINE_TEXT_ELEMENTS = new Set(['A', 'BUTTON', 'LABEL', 'LEGEND', 'OPTION', 'SPAN', 'STRONG', 'EM', 'TIME']);
const FORMAT_BLOCK_TAGS = 'html|head|body|header|main|aside|section|div|form|ul|ol|li|p|dl|dt|dd|blockquote|pre|table|thead|tbody|tr|td|h[1-6]';

function normalizeLineEndings(value) {
	return value.replace(/\r\n?/g, '\n');
}

function parseHeaders(source) {
	const headers = new Map();
	const unfolded = normalizeLineEndings(source).replace(/\n[ \t]+/g, ' ');
	for (const line of unfolded.split('\n')) {
		const separator = line.indexOf(':');
		if (separator < 1) continue;
		headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
	}
	return headers;
}

function decodeQuotedPrintable(source) {
	const normalized = normalizeLineEndings(source).replace(/=\n/g, '');
	const bytes = [];
	let index = 0;
	while (index < normalized.length) {
		const hex = normalized.slice(index + 1, index + 3);
		if (normalized[index] === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
			bytes.push(parseInt(hex, 16));
			index += 3;
		} else {
			bytes.push(...Buffer.from(normalized[index], 'utf8'));
			index += 1;
		}
	}
	return Buffer.from(bytes).toString('utf8');
}

function decodeMimeBody(body, transferEncoding) {
	if (/base64/i.test(transferEncoding || '')) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
	if (/quoted-printable/i.test(transferEncoding || '')) return decodeQuotedPrintable(body);
	return body;
}

export function extractHtmlDocument(source) {
	const normalized = normalizeLineEndings(source);
	const headerEnd = normalized.indexOf('\n\n');
	if (headerEnd < 0) return normalized;
	const envelopeHeaders = parseHeaders(normalized.slice(0, headerEnd));
	const contentType = envelopeHeaders.get('content-type') || '';
	if (!/^multipart\/related\b/i.test(contentType)) return normalized;

	const boundaryMatch = contentType.match(/\bboundary=(?:"([^"]+)"|([^;\s]+))/i);
	if (!boundaryMatch) throw new Error('Refusing to import malformed MHTML: multipart boundary is missing.');
	const boundary = boundaryMatch[1] || boundaryMatch[2];
	for (const rawPart of normalized.slice(headerEnd + 2).split(`--${boundary}`)) {
		const part = rawPart.replace(/^\n/, '').replace(/\n$/, '');
		if (!part || part === '--') continue;
		const partHeaderEnd = part.indexOf('\n\n');
		if (partHeaderEnd < 0) continue;
		const headers = parseHeaders(part.slice(0, partHeaderEnd));
		if (!/^text\/html\b/i.test(headers.get('content-type') || '')) continue;
		return decodeMimeBody(part.slice(partHeaderEnd + 2).replace(/\n--$/, ''), headers.get('content-transfer-encoding'));
	}
	throw new Error('Refusing to import MHTML: no text/html document part was found.');
}

function stableHash(value) {
	return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function sourceLabel(sourceName) {
	const extension = path.extname(sourceName || '').toLowerCase();
	return ['.html', '.htm', '.mhtml', '.mht'].includes(extension) ? `capture${extension}` : 'capture';
}

function assertOldRedditDocument(document) {
	const root = document.documentElement;
	if (!root || root.getAttribute('xmlns') !== OLD_REDDIT_XMLNS) {
		throw new Error(`Refusing to import: the capture is missing <html xmlns="${OLD_REDDIT_XMLNS}">, so RES-Slim would classify it as new Reddit.`);
	}

	const body = document.body;
	if (!body) throw new Error('Refusing to import: capture has no body.');
	const privateClass = PRIVATE_BODY_CLASSES.find(name => body.classList.contains(name));
	if (privateClass || document.querySelector('#siteTable.message-list')) {
		throw new Error(`Refusing to import private Reddit surface${privateClass ? ` (${privateClass})` : ''}. Capture a public listing or discussion page.`);
	}
}

function detectKind(document, requestedKind = 'auto') {
	const detected = document.body.classList.contains('comments-page') || document.querySelector('.commentarea') ?
		FIXTURE_KIND.thread : FIXTURE_KIND.frontpage;
	if (requestedKind !== 'auto' && requestedKind !== detected) {
		throw new Error(`Requested ${requestedKind} fixture, but the capture looks like ${detected}.`);
	}
	return detected;
}

function stripExecutableAndPrivateNodes(document) {
	for (const selector of REMOVE_SELECTORS) {
		for (const element of document.querySelectorAll(selector)) element.remove();
	}

	for (const element of document.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value;
			if (name.startsWith('on') || ['nonce', 'integrity', 'crossorigin', 'style', 'srcdoc', 'srcset', 'imagesrcset', 'ping'].includes(name) ||
				(SECRET_NAME_PATTERN.test(name) && !name.startsWith('aria-')) ||
				(name.startsWith('data-') && !SAFE_DATA_ATTRIBUTES.has(name)) ||
				SECRET_VALUE_PATTERN.test(value)) {
				element.removeAttribute(attribute.name);
			}
		}
	}
}

function rewriteUrl(raw, kind, attributeName) {
	const value = raw.trim();
	if (!value || value.startsWith('#') || /^javascript:void\(0\)$/i.test(value)) return '#';
	if (/^(?:data|blob|file|chrome-extension|moz-extension|javascript):/i.test(value)) return '#';

	let parsed;
	try {
		parsed = new URL(value, 'https://old.reddit.com/');
	} catch (error) {
		return '#';
	}

	if (parsed.hostname === 'reddit.com' || parsed.hostname.endsWith('.reddit.com')) {
		if (/^\/(?:user|u)\//i.test(parsed.pathname)) return '/user/fixture_author/';
		if (/^\/message(?:\/|$)/i.test(parsed.pathname)) return '/message/inbox/';
		if (/^\/r\/[^/]+\/comments\//i.test(parsed.pathname)) {
			return kind === FIXTURE_KIND.thread ? '/r/fixture/comments/thread000001/fixture-thread/' : '/r/fixture/comments/post0000001/fixture-post/';
		}
		if (/^\/(?:comments|duplicates|gallery)\//i.test(parsed.pathname)) {
			return kind === FIXTURE_KIND.thread ? '/r/fixture/comments/thread000001/fixture-thread/' : 'https://example.invalid/fixture';
		}
		if (/^\/domain\//i.test(parsed.pathname)) return '/domain/example.invalid/';
		if (/^\/r\/[^/]+/i.test(parsed.pathname)) return '/r/fixture/';
		return parsed.pathname.startsWith('/') ? parsed.pathname : '/';
	}

	if (attributeName === 'src' || attributeName === 'poster') return '';
	return 'https://example.invalid/fixture';
}

function normalizeAttributes(document, kind) {
	for (const element of document.querySelectorAll('*')) {
		for (const attributeName of ['href', 'src', 'poster', 'action', 'formaction']) {
			if (!element.hasAttribute(attributeName)) continue;
			const rewritten = rewriteUrl(element.getAttribute(attributeName) || '', kind, attributeName);
			if (rewritten) element.setAttribute(attributeName, rewritten);
			else element.removeAttribute(attributeName);
		}

		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			if (name === 'datetime') {
				element.setAttribute(attribute.name, '2000-01-01T00:00:00.000Z');
				continue;
			}
			if (name.startsWith('aria-') || name === 'title' || name === 'alt' || name === 'placeholder') {
				if (!SAFE_TEXT_PATTERN.test(attribute.value.trim())) element.setAttribute(attribute.name, 'Fixture control');
			}
		}
	}
}

function sanitizeClassList(element) {
	for (const className of [...element.classList]) {
		if (/^(?:id-|author-|user-|userattrs-|res(?:-|$))/i.test(className)) element.classList.remove(className);
	}
}

function pruneToTargets(root, selectors) {
	const targets = selectors.flatMap(selector => [...root.querySelectorAll(selector)]);
	if (!targets.length) return;
	for (const element of [...root.querySelectorAll('*')]) {
		const retained = targets.some(target => target === element || target.contains(element) || element.contains(target));
		if (!retained) element.remove();
	}
}

function collapseDirectChildren(parent, selector, keep) {
	const matches = [...parent.children].filter(child => child.matches(selector));
	for (const element of matches.slice(keep)) element.remove();
}

function projectStructuralFixture(document, kind) {
	for (const element of [...document.head.children]) {
		if (element.tagName !== 'TITLE' && !element.matches('meta[name="viewport"], meta[charset]')) element.remove();
	}

	const header = document.querySelector('#header[role="banner"], #header');
	const outsideSubredditBar = document.querySelector('body > #sr-header-area');
	const sidebar = document.querySelector('.side');
	const content = document.querySelector('.content[role="main"], main.content');
	const bodyRoots = [outsideSubredditBar, header, sidebar, content].filter(Boolean);
	for (const child of [...document.body.children]) {
		if (!bodyRoots.includes(child)) child.remove();
	}

	const subredditBar = document.querySelector('#sr-header-area');
	if (subredditBar) {
		const list = subredditBar.querySelector('.sr-list');
		if (list) list.replaceChildren();
		pruneToTargets(subredditBar, ['.sr-list', '#sr-more-link']);
	}

	if (header) {
		const left = header.querySelector('#header-bottom-left');
		const right = header.querySelector('#header-bottom-right');
		if (left) {
			pruneToTargets(left, ['.pagename', '.tabmenu']);
			const menu = left.querySelector('.tabmenu');
			if (menu) collapseDirectChildren(menu, 'li', 1);
		}
		if (right) pruneToTargets(right, ['.user', '#mail', '#RESSettingsButton']);
		pruneToTargets(header, ['#sr-header-area', '#header-bottom-left', '#header-bottom-right']);
	}

	if (sidebar) {
		const search = sidebar.querySelector('#search');
		sidebar.replaceChildren();
		if (search) {
			pruneToTargets(search, ['input[name="q"]']);
			const spacer = document.createElement('div');
			spacer.className = 'spacer';
			spacer.append(search);
			sidebar.append(spacer);
		}
		const spacer = document.createElement('div');
		spacer.className = 'spacer';
		sidebar.append(spacer);
	}

	if (!content) return;
	pruneToTargets(content, ['#siteTable.linklisting', '.commentarea']);
	const listing = content.querySelector('#siteTable.linklisting, .linklisting');
	if (listing) {
		collapseDirectChildren(listing, '.thing.link', kind === FIXTURE_KIND.thread ? 1 : 3);
		for (const thing of listing.querySelectorAll(':scope > .thing.link')) {
			pruneToTargets(thing, ['.midcol', '.thumbnail', '.entry']);
			const entry = thing.querySelector('.entry');
			if (entry) {
				pruneToTargets(entry, ['.title', '.tagline', '.flat-list.buttons', '.expando-button', '.expando', '.usertext-body']);
				for (const expando of entry.querySelectorAll('.expando')) {
					const usertextBody = expando.querySelector('.usertext-body');
					expando.replaceChildren();
					if (usertextBody) expando.append(usertextBody);
				}
			}
		}
	}

	const commentArea = content.querySelector('.commentarea');
	if (!commentArea) return;
	const composer = [...commentArea.children].find(child => child.matches('form.usertext'));
	const commentList = commentArea.querySelector('.sitetable.nestedlisting');
	pruneToTargets(commentArea, [':scope > form.usertext', ':scope > .sitetable.nestedlisting']);
	if (composer) pruneToTargets(composer, ['textarea[name="text"]', '.usertext-buttons']);
	if (!commentList) return;
	collapseDirectChildren(commentList, '.thing.comment', 2);
	for (const comment of commentList.querySelectorAll('.thing.comment')) {
		pruneToTargets(comment, ['.entry', '.child']);
		const entry = comment.querySelector('.entry');
		if (entry) pruneToTargets(entry, ['.tagline', '.usertext-body', '.flat-list.buttons', '.reportform']);
		const childList = comment.querySelector(':scope > .child > .sitetable');
		if (childList) collapseDirectChildren(childList, '.thing.comment', 1);
	}
	for (const overflow of [...commentList.querySelectorAll('.thing.comment')].slice(4)) overflow.remove();
	for (const moreChildren of commentList.querySelectorAll('.morechildren')) moreChildren.remove();
}

function normalizeStructuralData(document, kind) {
	const posts = [...document.querySelectorAll('.thing.link')];
	const comments = [...document.querySelectorAll('.thing.comment')];
	const postIndexes = new Map(posts.map((element, index) => [element, index + 1]));
	const commentIndexes = new Map(comments.map((element, index) => [element, index + 1]));
	const fullnameMap = new Map();
	for (const [element, index] of postIndexes) {
		const oldValue = element.getAttribute('data-fullname');
		if (oldValue) fullnameMap.set(oldValue, `t3_post${String(index).padStart(8, '0')}`);
	}
	for (const [element, index] of commentIndexes) {
		const oldValue = element.getAttribute('data-fullname');
		if (oldValue) fullnameMap.set(oldValue, `t1_comment${String(index).padStart(6, '0')}`);
	}
	const fullnameReplacements = [...fullnameMap].sort((a, b) => b[0].length - a[0].length);

	for (const element of document.querySelectorAll('*')) {
		sanitizeClassList(element);
		const postIndex = postIndexes.get(element) || 0;
		const commentIndex = commentIndexes.get(element) || 0;
		const isPost = postIndex > 0;
		const isComment = commentIndex > 0;

		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			if (!name.startsWith('data-')) continue;
			if (!SAFE_DATA_ATTRIBUTES.has(name)) {
				element.removeAttribute(attribute.name);
				continue;
			}
			switch (name) {
				case 'data-author': element.setAttribute(name, TEXT_PLACEHOLDERS.author); break;
				case 'data-subreddit': element.setAttribute(name, TEXT_PLACEHOLDERS.subreddit); break;
				case 'data-subreddit-prefixed': element.setAttribute(name, `r/${TEXT_PLACEHOLDERS.subreddit}`); break;
				case 'data-domain': element.setAttribute(name, kind === FIXTURE_KIND.thread ? 'self.fixture' : 'example.invalid'); break;
				case 'data-url': element.setAttribute(name, kind === FIXTURE_KIND.thread ? '/r/fixture/comments/thread000001/fixture-thread/' : 'https://example.invalid/fixture'); break;
				case 'data-permalink': element.setAttribute(name, isComment ? `/r/fixture/comments/thread000001/fixture-thread/comment${String(commentIndex).padStart(6, '0')}/` : `/r/fixture/comments/${kind === FIXTURE_KIND.thread ? 'thread000001/fixture-thread' : `post${String(postIndex).padStart(7, '0')}/fixture-post`}/`); break;
				case 'data-fullname': {
					if (isComment) element.setAttribute(name, `t1_comment${String(commentIndex).padStart(6, '0')}`);
					else if (isPost) element.setAttribute(name, `t3_post${String(postIndex).padStart(8, '0')}`);
					else element.removeAttribute(name);
					break;
				}
				case 'data-score':
				case 'data-res-slim-ups': element.setAttribute(name, '12'); break;
				case 'data-comments-count': element.setAttribute(name, '42'); break;
				case 'data-replies': element.setAttribute(name, element.querySelector('.child .thing.comment') ? '1' : '0'); break;
				case 'data-num-crossposts': element.setAttribute(name, '0'); break;
				case 'data-promoted':
				case 'data-nsfw':
				case 'data-spoiler':
				case 'data-oc': element.setAttribute(name, 'false'); break;
				default: break;
			}
		}

		if (isPost && element.id.startsWith('thing_t3_')) element.id = `thing_t3_post${String(postIndex).padStart(8, '0')}`;
		if (isComment && element.id.startsWith('thing_t1_')) element.id = `thing_t1_comment${String(commentIndex).padStart(6, '0')}`;
		for (const attribute of [...element.attributes]) {
			let value = attribute.value;
			for (const [oldFullname, newFullname] of fullnameReplacements) value = value.replaceAll(oldFullname, newFullname);
			attribute.value = value
				.replace(/\bt3_(?!post\d{8}\b)[a-z0-9]+\b/gi, 't3_post00000001')
				.replace(/\bt1_(?!comment\d{6}\b)[a-z0-9]+\b/gi, 't1_comment000001')
				.replace(/\bt5_(?!fixture\d{6}\b)[a-z0-9]+\b/gi, 't5_fixture000001');
		}
	}

	for (const element of document.querySelectorAll('[id]')) {
		if (STATIC_STRUCTURAL_IDS.has(element.id) || NORMALIZED_THING_ID_PATTERN.test(element.id)) continue;
		if (element.matches('.commentarea > form.usertext')) {
			element.id = 'form-t3_post00000001';
			continue;
		}
		element.removeAttribute('id');
	}
}

function directText(element) {
	return [...element.childNodes]
		.filter(node => node.nodeType === 3)
		.map(node => node.textContent || '')
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function replaceTextNode(node, replacement) {
	node.textContent = replacement;
}

function normalizeVisibleText(document) {
	for (const element of document.querySelectorAll('textarea, input')) {
		element.removeAttribute('value');
		if (element instanceof document.defaultView.HTMLTextAreaElement) element.textContent = '';
	}

	for (const element of document.querySelectorAll('.author')) element.textContent = TEXT_PLACEHOLDERS.author;
	for (const element of document.querySelectorAll('.subreddit')) element.textContent = `r/${TEXT_PLACEHOLDERS.subreddit}`;
	for (const element of document.querySelectorAll('a.title, a.search-title')) element.textContent = TEXT_PLACEHOLDERS.postTitle;
	for (const element of document.querySelectorAll('.usertext-body .md')) {
		element.replaceChildren(document.createElement('p'));
		element.firstElementChild.textContent = TEXT_PLACEHOLDERS.commentBody;
	}
	for (const element of document.querySelectorAll('.userkarma')) element.textContent = '1234';
	for (const element of document.querySelectorAll('.score')) element.textContent = '12';

	for (const element of document.querySelectorAll('body *')) {
		if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(element.tagName)) continue;
		if (element.matches('.author, .subreddit, a.title, a.search-title')) continue;
		for (const node of [...element.childNodes]) {
			if (node.nodeType !== 3) continue;
			const value = (node.textContent || '').replace(/\s+/g, ' ').trim();
			if (!value || SAFE_TEXT_PATTERN.test(value)) continue;
			if (element.closest('.title')) replaceTextNode(node, TEXT_PLACEHOLDERS.postTitle);
			else if (element.closest('.tagline')) replaceTextNode(node, ' submitted by ');
			else if (element.closest('.md')) replaceTextNode(node, TEXT_PLACEHOLDERS.commentBody);
			else if (INLINE_TEXT_ELEMENTS.has(element.tagName)) replaceTextNode(node, 'fixture');
			else replaceTextNode(node, ' Fixture content. ');
		}
	}

	for (const element of document.querySelectorAll('[contenteditable]')) {
		element.removeAttribute('contenteditable');
		if (!SAFE_TEXT_PATTERN.test(directText(element))) element.textContent = '';
	}
}

function collapseCollection(parent, selector, keep) {
	const elements = [...parent.querySelectorAll(`:scope > ${selector}`)];
	for (const element of elements.slice(keep)) element.remove();
}

function boundFixtureSize(document, kind) {
	const listing = document.querySelector('#siteTable.linklisting, .linklisting');
	if (listing) collapseCollection(listing, '.thing.link', kind === FIXTURE_KIND.thread ? 1 : 3);

	if (kind === FIXTURE_KIND.thread) {
		const comments = document.querySelector('.commentarea .sitetable.nestedlisting');
		if (comments) collapseCollection(comments, '.thing.comment', 2);
		for (const childList of document.querySelectorAll('.thing.comment > .child > .sitetable')) collapseCollection(childList, '.thing.comment', 1);
	}
}

function stripEmptyNoise(document) {
	for (const element of document.querySelectorAll('style')) element.remove();
	const comments = [];
	const iterator = document.createNodeIterator(document, 128);
	let comment = iterator.nextNode();
	while (comment) {
		comments.push(comment);
		comment = iterator.nextNode();
	}
	for (const comment of comments) comment.remove();
	for (const element of document.querySelectorAll('meta')) {
		if (element.getAttribute('name') !== 'viewport' && !element.hasAttribute('charset')) element.remove();
	}
}

function formatSerializedHtml(source) {
	const boundaryPattern = new RegExp(`(<\\/?(?:${FORMAT_BLOCK_TAGS})(?:\\s[^>]*)?>)`, 'gi');
	const lines = normalizeLineEndings(source)
		.replace(boundaryPattern, '\n$1\n')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean);
	const openingPattern = new RegExp(`^<(?:${FORMAT_BLOCK_TAGS})(?:\\s[^>]*)?>$`, 'i');
	const closingPattern = new RegExp(`^<\\/(?:${FORMAT_BLOCK_TAGS})>$`, 'i');
	let depth = 0;
	const formattedLines = lines.map(line => {
		if (closingPattern.test(line)) depth = Math.max(0, depth - 1);
		const formatted = `${'\t'.repeat(depth)}${line}`;
		if (openingPattern.test(line)) depth += 1;
		return formatted;
	});
	return `${formattedLines.join('\n')}\n`;
}

function serializeFixture(document, { kind, sourceName, capturedAt }) {
	document.documentElement.setAttribute('xmlns', OLD_REDDIT_XMLNS);
	document.documentElement.setAttribute('lang', 'en');
	document.documentElement.setAttribute('xml:lang', 'en');
	document.title = kind === FIXTURE_KIND.thread ? 'Fixture discussion : fixture' : 'reddit: fixture front page';
	const serialized = formatSerializedHtml(`<!doctype html>\n${document.documentElement.outerHTML}`);
	const digest = stableHash(serialized);
	const comment = `<!-- Sanitized from ${sourceLabel(sourceName)} captured ${capturedAt}; structural fixture only; sha256:${digest}. -->`;
	return serialized.replace('<!doctype html>\n', `<!doctype html>\n${comment}\n`);
}

export function sanitizeFixtureHtml(source, { kind = 'auto', sourceName = 'capture.html', capturedAt = 'unknown' } = {}) {
	const dom = new JSDOM(extractHtmlDocument(source));
	const { document } = dom.window;
	assertOldRedditDocument(document);
	const detectedKind = detectKind(document, kind);
	stripExecutableAndPrivateNodes(document);
	projectStructuralFixture(document, detectedKind);
	normalizeAttributes(document, detectedKind);
	normalizeStructuralData(document, detectedKind);
	normalizeVisibleText(document);
	boundFixtureSize(document, detectedKind);
	stripEmptyNoise(document);
	return {
		kind: detectedKind,
		html: serializeFixture(document, { kind: detectedKind, sourceName, capturedAt }),
	};
}

export function assertSanitizedFixture(html) {
	if (!html.includes(`xmlns="${OLD_REDDIT_XMLNS}"`)) throw new Error('Sanitized fixture lost the old-Reddit xmlns marker.');
	const forbidden = [
		/<script\b/i,
		/<iframe\b/i,
		/\bon[a-z]+\s*=/i,
		/(?:cookie|csrf|modhash|password|session|token)\s*[:=]/i,
		/(?:\/u(?:ser)?\/)(?!fixture_author)/i,
		/@[a-z0-9_.-]+\.[a-z]{2,}/i,
		/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/i,
	];
	for (const pattern of forbidden) {
		if (pattern.test(html)) throw new Error(`Sanitized fixture still matches forbidden privacy pattern ${pattern}.`);
	}

	const { document } = new JSDOM(html).window;
	if ([...document.documentElement.classList].some(name => name === 'res' || name.startsWith('res-'))) {
		throw new Error('Sanitized fixture retains extension-initialization classes.');
	}
	const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
	if (new Set(ids).size !== ids.length) throw new Error('Sanitized fixture contains duplicate element IDs.');
	for (const id of ids) {
		if (!STATIC_STRUCTURAL_IDS.has(id) && !NORMALIZED_THING_ID_PATTERN.test(id) && id !== 'form-t3_post00000001') {
			throw new Error(`Sanitized fixture retains unreviewed element ID ${id}.`);
		}
	}
	for (const element of document.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value;
			if (name.startsWith('on') || ['nonce', 'integrity', 'style', 'srcdoc', 'srcset', 'imagesrcset', 'ping'].includes(name)) {
				throw new Error(`Sanitized fixture retains active or opaque attribute ${name}.`);
			}
			if ((SECRET_NAME_PATTERN.test(name) && !name.startsWith('aria-')) || SECRET_VALUE_PATTERN.test(value)) {
				throw new Error(`Sanitized fixture retains secret-shaped attribute ${name}.`);
			}
			if (name.startsWith('data-') && !SAFE_DATA_ATTRIBUTES.has(name)) {
				throw new Error(`Sanitized fixture retains unreviewed attribute ${name}.`);
			}
			if (['href', 'src', 'poster', 'action', 'formaction'].includes(name) && value && value !== '#' && !value.startsWith('/')) {
				let parsed;
				try {
					parsed = new URL(value);
				} catch (error) {
					throw new Error(`Sanitized fixture contains malformed URL in ${name}.`);
				}
				if (parsed.hostname !== 'example.invalid') throw new Error(`Sanitized fixture retains external host ${parsed.hostname}.`);
			}
		}
	}

	for (const node of document.querySelectorAll('body *')) {
		for (const child of [...node.childNodes]) {
			if (child.nodeType !== 3) continue;
			const value = (child.textContent || '').replace(/\s+/g, ' ').trim();
			if (!value || SAFE_TEXT_PATTERN.test(value) || [
				TEXT_PLACEHOLDERS.author,
				TEXT_PLACEHOLDERS.commentBody,
				TEXT_PLACEHOLDERS.postTitle,
				TEXT_PLACEHOLDERS.subreddit,
				`r/${TEXT_PLACEHOLDERS.subreddit}`,
				'Fixture content.',
				'submitted by',
			].includes(value)) continue;
			throw new Error(`Sanitized fixture retains unreviewed visible text: ${value.slice(0, 40)}`);
		}
	}
	return true;
}

export function importFixtureFile(inputPath, outputPath, options = {}) {
	const source = fs.readFileSync(inputPath, 'utf8');
	const result = sanitizeFixtureHtml(source, { ...options, sourceName: options.sourceName || inputPath });
	assertSanitizedFixture(result.html);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, result.html, 'utf8');
	return result;
}
