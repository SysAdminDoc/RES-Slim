/* @flow */

export const surfaceSelectors = Object.freeze({
	pageRoot: {
		stable: ['body.listing-page', 'body.comments-page', 'body.single-page'],
		fallback: ['body.res-v0-4-0'],
	},
	header: {
		stable: ['#header[role="banner"]'],
		fallback: ['#header-bottom-left .tabmenu'],
	},
	subredditBar: {
		stable: ['#sr-header-area .sr-list'],
		fallback: ['#sr-more-link'],
	},
	userbar: {
		stable: ['#header-bottom-right'],
		fallback: ['.user .userkarma'],
	},
	mail: {
		stable: ['#mail', '#modmail', '#new_modmail'],
		fallback: ['#header-bottom-right .message-count'],
	},
	search: {
		stable: ['#search[role="search"] input[name="q"]'],
		fallback: ['.side #search input[type="text"]'],
	},
	listingFeed: {
		stable: ['#siteTable.sitetable.linklisting'],
		fallback: ['.linklisting .thing.link'],
	},
	post: {
		stable: ['.thing.link[data-fullname][data-permalink]'],
		fallback: ['.linklisting .thing.link.odd', '.linklisting .thing.link.even'],
	},
	postTitle: {
		stable: ['.thing.link[data-fullname] a.title'],
		fallback: ['.entry .title'],
	},
	postMetadata: {
		stable: ['.thing.link[data-subreddit][data-domain][data-author]'],
		fallback: ['.tagline .subreddit', '.tagline .author'],
	},
	postActions: {
		stable: ['.thing.link[data-fullname] .entry .buttons'],
		fallback: ['.entry > ul.flat-list.buttons'],
	},
	voteColumn: {
		stable: ['.thing[data-fullname] .midcol .arrow[role="button"]'],
		fallback: ['.midcol .arrow.up', '.midcol .arrow.down'],
	},
	score: {
		stable: ['.thing[data-fullname] .score'],
		fallback: ['.midcol .score.unvoted'],
	},
	expandoButton: {
		stable: ['.thing[data-fullname] .expando-button'],
		fallback: ['.expando-button.video', '.expando-button.image'],
	},
	expando: {
		stable: ['.thing[data-fullname] .expando'],
		fallback: ['.entry .expando'],
	},
	thumbnail: {
		stable: ['.thing[data-fullname] a.thumbnail'],
		fallback: ['.thumbnail.self', '.thumbnail.default'],
	},
	sidebar: {
		stable: ['.side'],
		fallback: ['body > .content + .side'],
	},
	commentArea: {
		stable: ['.commentarea'],
		fallback: ['div.commentarea > div.sitetable'],
	},
	commentList: {
		stable: ['.commentarea .sitetable.nestedlisting'],
		fallback: ['.nestedlisting'],
	},
	comment: {
		stable: ['.thing.comment[data-fullname][data-author]'],
		fallback: ['.comment.noncollapsed', '.comment.collapsed'],
	},
	commentBody: {
		stable: ['.thing.comment[data-fullname] .usertext-body'],
		fallback: ['.comment .md'],
	},
	commentChildren: {
		stable: ['.thing.comment[data-fullname] > .child'],
		fallback: ['.comment .child .sitetable'],
	},
	collapseControl: {
		stable: ['.thing.comment[data-fullname] .expand'],
		fallback: ['.comment .entry .tagline .expand'],
	},
	composerForm: {
		stable: ['form.usertext textarea[name="text"]'],
		fallback: ['.usertext-edit textarea'],
	},
	submitButton: {
		stable: ['form.usertext button[type="submit"]'],
		fallback: ['.usertext-buttons button.save'],
	},
	reportForm: {
		stable: ['.reportform'],
		fallback: ['.report-button + form'],
	},
	saveHideControls: {
		stable: ['.save-button', '.hide-button'],
		fallback: ['.buttons .first', '.buttons li a'],
	},
	author: {
		stable: ['.tagline .author'],
		fallback: ['a.author'],
	},
	profileListing: {
		stable: ['.profile-page .sitetable .thing'],
		fallback: ['body.profile-page .thing'],
	},
	modQueue: {
		stable: ['body.modqueue-page .thing[data-fullname]'],
		fallback: ['.modqueue .thing'],
	},
	settingsButton: {
		stable: ['#RESSettingsButton'],
		fallback: ['.RESSettingsButton'],
	},
	settingsOverlay: {
		stable: ['#RESConsoleContainer'],
		fallback: ['.RESDialogSmall'],
	},
});

export const fixtureSurfaces = Object.freeze({
	frontpage: [
		'pageRoot',
		'header',
		'subredditBar',
		'userbar',
		'search',
		'listingFeed',
		'post',
		'postTitle',
		'postMetadata',
		'postActions',
		'voteColumn',
		'score',
		'expandoButton',
		'expando',
		'thumbnail',
		'sidebar',
		'author',
		'settingsButton',
	],
	thread: [
		'pageRoot',
		'header',
		'userbar',
		'search',
		'commentArea',
		'commentList',
		'comment',
		'commentBody',
		'commentChildren',
		'collapseControl',
		'composerForm',
		'submitButton',
		'reportForm',
		'saveHideControls',
		'author',
		'settingsButton',
	],
});

export const highChurnSurfaces = Object.freeze([
	'expandoButton',
	'expando',
	'commentChildren',
	'collapseControl',
	'composerForm',
	'reportForm',
	'settingsOverlay',
]);

// Only surfaces that old Reddit renders unconditionally for the applicable page
// type belong here. Item-level selectors such as `post` and `comment` are not
// required because an empty listing or discussion is valid and must not create a
// false alarm in the local diagnostics log.
export const diagnosticSurfacesByPageType = Object.freeze({
	linklist: ['pageRoot', 'header', 'userbar', 'listingFeed'],
	commentsLinklist: ['pageRoot', 'header', 'userbar', 'listingFeed'],
	search: ['pageRoot', 'header', 'userbar', 'listingFeed'],
	profile: ['pageRoot', 'header', 'userbar', 'listingFeed'],
	modqueue: ['pageRoot', 'header', 'userbar', 'listingFeed'],
	comments: ['pageRoot', 'header', 'userbar', 'commentArea', 'commentList'],
});

export type SurfaceMatch = {|
	surfaceName: string,
	status: 'stable' | 'fallback' | 'missing',
	selector: ?string,
|};

export function getSurfaceSelectorList(surfaceName: string): Array<string> {
	const surface = surfaceSelectors[surfaceName];
	if (!surface) throw new Error(`Unknown old Reddit surface: ${surfaceName}`);
	return [...surface.stable, ...surface.fallback];
}

export function getStableSelector(surfaceName: string): string {
	const surface = surfaceSelectors[surfaceName];
	if (!surface) throw new Error(`Unknown old Reddit surface: ${surfaceName}`);
	return surface.stable[0];
}

// Resolve a surface to a live element, trying the stable selector first and
// each fallback in turn.
//
// This is what makes the map above an asset rather than documentation. A module
// that hardcodes one selector silently no-ops when Reddit renames a class —
// nothing throws, the feature just stops appearing — which is the exact failure
// mode Reddit’s announced old.reddit changes would cause at scale.
export function findSurface(surfaceName: string, root: Document | HTMLElement = document): ?HTMLElement {
	for (const selector of getSurfaceSelectorList(surfaceName)) {
		const found = root.querySelector(selector);
		// nodeType rather than `instanceof HTMLElement`: a content script can be
		// handed an element from another realm (an iframe's document), where the
		// instanceof check is false for a perfectly good element.
		if (found && (found: any).nodeType === 1) return (found: any);
	}
	return null;
}

// Which selector actually matched, or null. Used by diagnostics: a surface
// resolving via a fallback is an early warning that the stable selector has
// rotted, and is worth knowing before the fallback rots too.
export function matchedSelectorFor(surfaceName: string, root: Document | HTMLElement = document): ?string {
	for (const selector of getSurfaceSelectorList(surfaceName)) {
		if (root.querySelector(selector)) return selector;
	}
	return null;
}

export function inspectSurfaceMatch(surfaceName: string, root: Document | HTMLElement = document): SurfaceMatch {
	const selector = matchedSelectorFor(surfaceName, root);
	let status: 'stable' | 'fallback' | 'missing' = 'missing';
	if (selector !== null) {
		status = surfaceSelectors[surfaceName].stable.includes(selector) ? 'stable' : 'fallback';
	}
	return {
		surfaceName,
		status,
		selector,
	};
}

export function selectorDriftForPage(pageType: ?string, root: Document | HTMLElement = document): SurfaceMatch[] {
	const required = pageType && diagnosticSurfacesByPageType[pageType];
	if (!required) return [];
	return required
		.map(surfaceName => inspectSurfaceMatch(surfaceName, root))
		.filter(match => match.status !== 'stable');
}

export function formatSelectorDriftMessage(pageType: string, findings: $ReadOnlyArray<SurfaceMatch>): string {
	const details = findings.map(finding => finding.status === 'fallback' ?
		`${finding.surfaceName} matched fallback "${finding.selector || ''}"` :
		`${finding.surfaceName} is missing`);
	return `Old Reddit selector drift detected on ${pageType}: ${details.join('; ')}.`;
}
