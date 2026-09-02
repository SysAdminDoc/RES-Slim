/* @flow */

/*
 * Ordering and identity for the settings console's category tabs.
 *
 * The order below is a reading order, not an alphabetical or a count-based
 * one: what a page looks like, then what is on it, then how you move around
 * it, then the console's own plumbing. Every category a module declares must
 * appear here — a category missing from this list sorts to -1 and would jump
 * ahead of everything else.
 */
export const CATEGORY_ORDER = [
	'appearanceCategory',
	'commentsCategory',
	'submissionsCategory',
	'subredditsCategory',
	'usersCategory',
	'myAccountCategory',
	'browsingCategory',
	'productivityCategory',
	'privacyCategory',
	'coreCategory',
	'aboutCategory',
];

// A few category names are written for a heading, not a tab. Shorter labels
// keep the strip on one row at the console's default width.
export const CATEGORY_TAB_LABEL_KEYS: { [category: string]: string } = {
	aboutCategory: 'settingsConsoleTabAbout',
};

// Pseudo-categories: they own a tab but no modules.
export const SEARCH_TAB_ID = '__search';
export const CONSOLE_PREFS_TAB_ID = '__console';
export const DATA_WORKSPACE_TAB_ID = '__data';

// Hash segment for the console-preferences tab, e.g. `#res:settings/console`.
// Must never collide with a real module ID; a contract test enforces that.
export const CONSOLE_PREFS_ROUTE = 'console';

// Hash segment for the local-data workspace, e.g. `#res:settings/data`. Old
// Reddit's own data panels link straight here.
export const DATA_WORKSPACE_ROUTE = 'data';
