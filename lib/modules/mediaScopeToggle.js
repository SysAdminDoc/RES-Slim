/* @flow */
// RES-Slim: per-surface media toggle. Lets the user enable inline media on
// posts but not on comments (or vice versa). Sits alongside the existing
// `showImages` module and overrides its expando behaviour for the
// suppressed surface via body-class-gated CSS. Closes a long-running
// r/Enhancement request.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';

export const module: Module<{ [string]: any }> = new Module('mediaScopeToggle');

module.moduleName = 'Post / comment media scope';
module.category = 'productivityCategory';
module.description = 'Independently disable inline media on posts only, or on comments only. The opposite surface keeps the existing `showImages` behavior. Useful when comments are full of distracting GIFs but you still want post expandos.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['media', 'post', 'comment', 'scope', 'toggle'];

module.options = {
	suppressInPosts: {
		type: 'boolean',
		value: false,
		title: 'Suppress media in posts',
		description: 'Hide the inline expando-button and any expanded media on listing posts. The expand toggle itself is hidden so the row stays compact.',
	},
	suppressInComments: {
		type: 'boolean',
		value: true,
		title: 'Suppress media in comments',
		description: 'Hide the inline expando-button and any expanded media inside comment trees. Most useful default, because comment galleries are the noisier surface.',
	},
	keepThumbnail: {
		type: 'boolean',
		value: true,
		title: 'Keep listing thumbnails',
		description: 'Listing thumbnails (the small left-rail image) remain visible even when post media is suppressed. Disable to hide thumbnails too.',
	},
	collapseLoadedExpando: {
		type: 'boolean',
		value: true,
		title: 'Collapse already-expanded media',
		description: 'On contentStart, click the close-toggle of any already-open expando on the suppressed surface so the page snaps shut.',
	},
};

const STYLE_ID = 'RSMMediaScopeToggleStyle';
const POSTS_CLASS = 'rsm-mediaScope-noPosts';
const COMMENTS_CLASS = 'rsm-mediaScope-noComments';
const NO_THUMB_CLASS = 'rsm-mediaScope-noThumb';

function buildCss(): string {
	const lines: string[] = [];

	// Suppress expando buttons + expanded media in the linklisting / single post.
	lines.push(`
		body.${POSTS_CLASS} #siteTable .thing.link > .entry .expando-button,
		body.${POSTS_CLASS} #siteTable_t3_ .thing.link > .entry .expando-button,
		body.${POSTS_CLASS} #siteTable .thing.link > .entry .expando {
			display: none !important;
		}
	`);

	lines.push(`
		body.${NO_THUMB_CLASS} #siteTable .thing.link > a.thumbnail {
			display: none !important;
		}
	`);

	// Suppress expando buttons + expanded media inside the comment tree.
	lines.push(`
		body.${COMMENTS_CLASS} .commentarea .thing.comment .expando-button,
		body.${COMMENTS_CLASS} .commentarea .thing.comment .expando {
			display: none !important;
		}
	`);

	return lines.join('\n');
}

function injectStyle(): void {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		(document.head || document.documentElement).append(style);
	}
	style.textContent = buildCss();
}

function applyClasses(): void {
	if (!document.body) return;
	const body = document.body;
	body.classList.toggle(POSTS_CLASS, module.options.suppressInPosts.value === true);
	body.classList.toggle(COMMENTS_CLASS, module.options.suppressInComments.value === true);
	body.classList.toggle(
		NO_THUMB_CLASS,
		module.options.suppressInPosts.value === true && module.options.keepThumbnail.value === false,
	);
}

function collapseExpanded(scope: 'post' | 'comment'): void {
	if (module.options.collapseLoadedExpando.value === false) return;
	const root = scope === 'post' ? document.querySelector('#siteTable') : document.querySelector('.commentarea');
	if (!root) return;
	const buttons = root.querySelectorAll('.expando-button.expanded');
	for (let i = 0; i < buttons.length; i++) {
		const btn = buttons[i];
		if (btn instanceof HTMLElement) {
			try { btn.click(); } catch (e) { /* swallow */ }
		}
	}
}

module.beforeLoad = () => { injectStyle(); };

module.contentStart = () => {
	injectStyle();
	applyClasses();
	if (module.options.suppressInPosts.value === true) collapseExpanded('post');
	if (module.options.suppressInComments.value === true) collapseExpanded('comment');
	// Re-collapse any expandos that initialise after this module runs (showImages
	// processes things asynchronously). watchForThings is the right hook.
	watchForThings(['post', 'comment'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		const isComment = el.classList.contains('comment');
		const suppressed = isComment ?
			module.options.suppressInComments.value === true :
			module.options.suppressInPosts.value === true;
		if (!suppressed) return;
		const btn = el.querySelector('.expando-button.expanded');
		if (btn instanceof HTMLElement) {
			try { btn.click(); } catch (e) { /* swallow */ }
		}
	});
};
