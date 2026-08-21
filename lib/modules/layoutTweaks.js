/* @flow */
// RES-Slim: a single layout/cosmetic module that injects body-class-scoped
// CSS toggles for the most-requested old-Reddit visual changes. Every
// toggle is reversible by clearing the body class, so the existing module
// destroy() flow has nothing extra to clean up.

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('layoutTweaks');

module.moduleName = 'Layout tweaks';
module.category = 'appearanceCategory';
module.description = 'Full-width feed, sidebar collapse, post numbering, and granular icon/avatar/flair/award hide switches across classic and current Reddit.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.keywords = ['layout', 'width', 'sidebar', 'awards', 'flair', 'avatar', 'icons', 'number'];

module.options = {
	fullWidth: {
		type: 'boolean',
		value: false,
		title: 'Full-width content',
		description: 'Stretch the post/comment column to fill the viewport.',
	},
	hideSidebar: {
		type: 'boolean',
		value: false,
		title: 'Hide right sidebar',
		description: 'Suppress the .side column on listings and threads.',
	},
	postNumbers: {
		type: 'boolean',
		value: false,
		title: 'Number posts in listings',
		description: 'Show a 1-based index next to each post row.',
	},
	hideAwards: {
		type: 'boolean',
		value: true,
		title: 'Hide award icons',
		description: 'Remove the per-post / per-comment award badges.',
	},
	hideFlair: {
		type: 'boolean',
		value: false,
		title: 'Hide user flair',
		description: 'Hide flair text alongside usernames.',
	},
	hideLinkFlair: {
		type: 'boolean',
		value: false,
		title: 'Hide post link flair',
		description: 'Hide the small coloured flair tag on submission titles.',
	},
	hideAvatars: {
		type: 'boolean',
		value: false,
		title: 'Hide user avatars',
		description: 'Hide round avatar thumbnails next to usernames where they exist.',
	},
};

const STYLE_ID = 'RSMLayoutTweaksStyle';

// Map of option key -> body class name and the CSS rule that depends on it.
const RULES: $ReadOnlyArray<{| key: string, className: string, css: string |}> = Object.freeze([
	{
		key: 'fullWidth',
		className: 'rsm-layout-full-width',
		css: 'body.rsm-layout-full-width .content[role="main"] { max-width: none !important; margin-right: 12px !important; } body.rsm-layout-full-width #subgrid-container { width: 100% !important; max-width: none !important; }',
	},
	{
		key: 'hideSidebar',
		className: 'rsm-layout-hide-sidebar',
		css: 'body.rsm-layout-hide-sidebar .side, body.rsm-layout-hide-sidebar #right-sidebar-container { display: none !important; } body.rsm-layout-hide-sidebar .content[role="main"] { margin-right: 12px !important; } body.rsm-layout-hide-sidebar #subgrid-container > .main-container { grid-template-columns: minmax(0, 1fr) !important; }',
	},
	{
		key: 'postNumbers',
		className: 'rsm-layout-post-numbers',
		css: '.rsm-layout-post-numbers #siteTable.linklisting, .rsm-layout-post-numbers shreddit-feed { counter-reset: rsm-post-counter; } .rsm-layout-post-numbers #siteTable.linklisting > .thing.link, .rsm-layout-post-numbers shreddit-feed > article { counter-increment: rsm-post-counter; position: relative; } .rsm-layout-post-numbers #siteTable.linklisting > .thing.link::before, .rsm-layout-post-numbers shreddit-feed > article::before { content: counter(rsm-post-counter); position: absolute; left: -36px; top: 8px; min-width: 24px; padding: 2px 6px; border-radius: 4px; background: rgb(255 122 24 / 16%); color: #ffb06a; font-weight: 600; font-size: 11px; text-align: center; }',
	},
	{
		key: 'hideAwards',
		className: 'rsm-layout-hide-awards',
		css: '.rsm-layout-hide-awards .awardings-bar, .rsm-layout-hide-awards .awardings-icon, .rsm-layout-hide-awards .award, .rsm-layout-hide-awards shreddit-award-button, .rsm-layout-hide-awards faceplate-award-bar { display: none !important; }',
	},
	{
		key: 'hideFlair',
		className: 'rsm-layout-hide-flair',
		css: '.rsm-layout-hide-flair .flair, .rsm-layout-hide-flair author-flair-event-handler { display: none !important; }',
	},
	{
		key: 'hideLinkFlair',
		className: 'rsm-layout-hide-link-flair',
		css: '.rsm-layout-hide-link-flair .linkflairlabel, .rsm-layout-hide-link-flair [slot="post-flair"] { display: none !important; }',
	},
	{
		key: 'hideAvatars',
		className: 'rsm-layout-hide-avatars',
		css: '.rsm-layout-hide-avatars img.snoovatar, .rsm-layout-hide-avatars .avatar, .rsm-layout-hide-avatars [slot="commentAvatar"] { display: none !important; }',
	},
]);

function applyClasses() {
	if (!document.body) return;
	const body = document.body;
	for (const { key, className } of RULES) {
		body.classList.toggle(className, !!module.options[key].value);
	}
}

function injectStyle() {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		(document.head || document.documentElement).append(style);
	}
	style.textContent = RULES.map(r => r.css).join('\n');
}

module.beforeLoad = () => {
	injectStyle();
};

module.contentStart = () => {
	injectStyle();
	applyClasses();
};
