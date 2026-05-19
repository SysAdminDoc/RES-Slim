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
