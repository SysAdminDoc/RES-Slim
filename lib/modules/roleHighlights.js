/* @flow */
// RES-Slim: refresh the OP / moderator / admin / friend role highlight lanes
// on old.reddit. Old.reddit ships subtle colour cues on `.author.submitter`,
// `.author.moderator`, `.author.admin`, and `.author.friend`; this module
// builds them out with body-class-gated CSS, optional backdrop tints, and an
// optional animated shimmer on role flair badges.

import { Module } from '../core/module';

export const module: Module<*> = new Module('roleHighlights');

module.moduleName = 'Role highlight lanes';
module.category = 'commentsCategory';
module.description = 'Refresh OP / moderator / admin / friend highlight lanes with per-role colour pickers, an optional backdrop tint, and an optional animated role-flair shimmer.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.keywords = ['op', 'mod', 'admin', 'friend', 'role', 'highlight', 'submitter'];

module.options = {
	highlightOP: {
		type: 'boolean',
		value: true,
		title: 'Highlight OP (submitter)',
		description: 'Colour-tag the comment author who submitted the post.',
	},
	opColor: {
		type: 'color',
		value: '#3b82f6',
		title: 'OP colour',
		description: 'Accent colour for the OP role lane.',
	},
	highlightMod: {
		type: 'boolean',
		value: true,
		title: 'Highlight moderators',
		description: 'Colour-tag moderators of the current subreddit.',
	},
	modColor: {
		type: 'color',
		value: '#22c55e',
		title: 'Moderator colour',
		description: 'Accent colour for the moderator role lane.',
	},
	highlightAdmin: {
		type: 'boolean',
		value: true,
		title: 'Highlight admins',
		description: 'Colour-tag site admins.',
	},
	adminColor: {
		type: 'color',
		value: '#ef4444',
		title: 'Admin colour',
		description: 'Accent colour for the admin role lane.',
	},
	highlightFriend: {
		type: 'boolean',
		value: false,
		title: 'Highlight friends',
		description: 'Colour-tag users marked as friend.',
	},
	friendColor: {
		type: 'color',
		value: '#a855f7',
		title: 'Friend colour',
		description: 'Accent colour for the friend lane.',
	},
	animateRoleFlair: {
		type: 'boolean',
		value: false,
		title: 'Animate role flair',
		description: 'Apply a soft shimmer to the `[M]` / `[A]` / `[S]` tag next to role authors.',
	},
	backdropHighlight: {
		type: 'boolean',
		value: false,
		title: 'Backdrop tint',
		description: 'Paint a subtle left-border tint on the entire entry, not just the author link.',
	},
};

const STYLE_ID = 'RSMRoleHighlightsStyle';

type Lane = {|
	option: string,
	bodyClass: string,
	authorSelector: string,
	flairSelector: string,
	color: string,
|};

function lanes(): Lane[] {
	return [
		{
			option: 'highlightOP',
			bodyClass: 'rsm-role-op',
			authorSelector: 'a.author.submitter',
			flairSelector: '.tagline a.author.submitter ~ .userattrs .submitter, .tagline a.author.submitter + .submitter',
			color: (module.options.opColor.value: any) || '#3b82f6',
		},
		{
			option: 'highlightMod',
			bodyClass: 'rsm-role-mod',
			authorSelector: 'a.author.moderator',
			flairSelector: '.tagline .userattrs .moderator',
			color: (module.options.modColor.value: any) || '#22c55e',
		},
		{
			option: 'highlightAdmin',
			bodyClass: 'rsm-role-admin',
			authorSelector: 'a.author.admin',
			flairSelector: '.tagline .userattrs .admin',
			color: (module.options.adminColor.value: any) || '#ef4444',
		},
		{
			option: 'highlightFriend',
			bodyClass: 'rsm-role-friend',
			authorSelector: 'a.author.friend',
			flairSelector: '.tagline .userattrs .friend',
			color: (module.options.friendColor.value: any) || '#a855f7',
		},
	];
}

function buildCss(): string {
	const rules: string[] = [];
	const backdropOn = module.options.backdropHighlight.value === true;
	const animateOn = module.options.animateRoleFlair.value === true;
	for (const lane of lanes()) {
		rules.push(`body.${lane.bodyClass} ${lane.authorSelector} { color: ${lane.color} !important; font-weight: 600 !important; }`);
		rules.push(`body.${lane.bodyClass} ${lane.flairSelector} { color: ${lane.color} !important; }`);
		if (backdropOn) {
			rules.push(`body.${lane.bodyClass} .thing.comment .entry:has(${lane.authorSelector}) { border-left: 3px solid ${lane.color} !important; padding-left: 6px !important; }`);
		}
	}
	if (animateOn) {
		rules.push(`
			.tagline .userattrs .moderator,
			.tagline .userattrs .admin,
			.tagline .userattrs .submitter,
			.tagline a.author.submitter ~ .userattrs .submitter,
			.tagline a.author.submitter + .submitter {
				background-image: linear-gradient(110deg, transparent 30%, rgb(255 255 255 / 18%) 50%, transparent 70%);
				background-size: 240% 100%;
				background-repeat: no-repeat;
				animation: rsm-role-shimmer 2.6s ease-in-out infinite;
			}

			@keyframes rsm-role-shimmer {
				0% { background-position: 200% 0; }
				100% { background-position: -100% 0; }
			}

			@media (prefers-reduced-motion: reduce) {
				.tagline .userattrs .moderator,
				.tagline .userattrs .admin,
				.tagline .userattrs .submitter,
				.tagline a.author.submitter ~ .userattrs .submitter,
				.tagline a.author.submitter + .submitter {
					animation: none;
				}
			}
		`);
	}
	return rules.join('\n');
}

function applyClasses(): void {
	if (!document.body) return;
	const body = document.body;
	for (const lane of lanes()) {
		body.classList.toggle(lane.bodyClass, !!module.options[lane.option].value);
	}
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

module.beforeLoad = () => { injectStyle(); };
module.contentStart = () => { injectStyle(); applyClasses(); };
