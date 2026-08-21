// One source for both shipped manifests.
//
// `chrome/manifest.json` and `firefox/manifest.json` were maintained by hand.
// They diverged correctly, which is the problem: two files, one intent, and
// nothing anywhere saying which differences are deliberate. This repo has
// already lost a target to exactly that — `firefox/beta/` accumulated
// permissions the shipped manifests never had plus an unsubstituted
// `__browser_mobile_min_version__` token, and was deleted rather than repaired.
//
// Everything below is shared unless a target says otherwise, and every
// MV2/MV3 difference is written as a named transform with the reason attached.
// `scripts/generate-manifests.mjs` writes the two files from this, and a
// contract fails when what is committed no longer matches — the same shape as
// the eslint, flow and bundle baselines.
//
// The `__token__` values are substituted at build time by the `build-manifest`
// esbuild plugin, not here, so the committed files keep carrying them. That is
// what stops a version or a browser floor becoming a second hardcoded copy.

const MATCHES = ['https://*.reddit.com/*'];

// Reddit surfaces this extension has no business on: the mod tools, the ads
// dashboard, the mobile and compact renderers, and every data endpoint. A
// content script at `document_start` on a `.json` URL is a parse of the response
// nobody asked for.
const EXCLUDE_MATCHES = [
	'https://mod.reddit.com/*',
	'https://ads.reddit.com/*',
	'https://i.reddit.com/*',
	'https://m.reddit.com/*',
	'https://static.reddit.com/*',
	'https://thumbs.reddit.com/*',
	'https://blog.reddit.com/*',
	'https://code.reddit.com/*',
	'https://about.reddit.com/*',
	'https://*.reddit.com/talk/*',
	'https://*.reddit.com/chat/*',
	'https://*.reddit.com/*.compact',
	'https://*.reddit.com/*.compact?*',
	'https://*.reddit.com/*.mobile',
	'https://*.reddit.com/*.mobile?*',
	'https://*.reddit.com/*.json',
	'https://*.reddit.com/*.json?*',
	'https://*.reddit.com/*.json-html',
	'https://*.reddit.com/*.json-html?*',
];

const PERMISSIONS = [
	'declarativeNetRequest',
	'tabs',
	'storage',
	'unlimitedStorage',
	'scripting',
];

// Requested at runtime, never at install. Everything here is an endpoint one
// optional module needs, and a user who never enables that module never grants
// it.
const OPTIONAL_HOST_PERMISSIONS = [
	'http://localhost/*',
	'http://127.0.0.1/*',
	'https://publish.twitter.com/oembed',
	'https://backend.deviantart.com/oembed',
	'https://api.gyazo.com/api/oembed',
	'https://api.tumblr.com/v2/blog/*/posts',
	'https://xkcd.com/*/info.0.json',
	'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/*',
	'https://*.redd.it/*',
	'https://www.flickr.com/services/oembed',
	'https://embed.bsky.app/oembed',
	'https://www.threads.com/*',
	'https://www.threads.net/*',
	'https://web.archive.org/*',
	'https://rimgo.reallyaweso.me/*',
	'https://rmgur.com/*',
];

// Reachable from a reddit page. `trackingSabotage.entry.js` is here because MV3
// refuses an inline script a content script writes — it is checked against the
// extension's own CSP, not the page's — so the page-world patch has to be a
// file the page can load by URL.
const WEB_ACCESSIBLE_RESOURCES = [
	'prompt.html',
	'prompt.entry.js',
	'options.css',
	'options.html',
	'trackingSabotage.entry.js',
];

const ICONS = { 48: 'icon48.png', 128: 'icon128.png' };
const ACTION_ICON = { 16: 'css-on-small.png', 32: 'css-on.png' };

// `self` is quoted inside a CSP source list, and the repo lints for single
// quotes, so it is escaped rather than switching the string delimiter.
const SELF = '\'self\'';

const CSP_DIRECTIVES = [
	`default-src ${SELF}`,
	`img-src ${SELF} data:`,
	'connect-src https: http://localhost:* http://127.0.0.1:*',
	`font-src ${SELF} data:`,
	'frame-ancestors https://*.reddit.com',
];

const CSP_SCRIPT_SRC = `script-src ${SELF}`;

const SHARED = {
	name: '__name__',
	version: '__version__',
	description: '__description__',
	author: '__author__',
	homepage_url: '__homepage__',
	icons: ICONS,
	options_ui: { page: 'options.html', open_in_tab: true },
	declarative_net_request: {
		rule_resources: [{ id: 'reddit_ads', enabled: true, path: 'ad-block.json' }],
	},
	content_scripts: [{
		matches: MATCHES,
		all_frames: false,
		exclude_matches: EXCLUDE_MATCHES,
		js: ['foreground.entry.js'],
		css: ['res.css'],
		run_at: 'document_start',
	}],
};

// Each entry is one MV2/MV3 difference and why it exists. Kept as data rather
// than as two files so that adding a key to one target and forgetting the other
// is a diff, not a discovery.
export const TRANSFORMS = [
	{
		keys: ['manifest_version'],
		reason: 'Chrome removed MV2. Firefox has no MV2 deprecation plan and commits to at least twelve months of notice, so there is no deadline behind moving off it.',
	},
	{
		keys: ['background'],
		reason: 'MV3 runs a service worker; MV2 runs a persistent background page from a scripts array.',
	},
	{
		keys: ['action', 'page_action'],
		reason: 'MV3 merged browser_action and page_action into one action key. MV2 Firefox still wants page_action, with the same icons.',
	},
	{
		keys: ['content_security_policy'],
		reason: 'MV3 takes an object keyed by context; MV2 takes one string. The MV3 form also states its script source explicitly, and that is the policy that refuses an injected inline script - worth being able to read rather than inferring from a default.',
	},
	{
		keys: ['permissions', 'host_permissions'],
		reason: 'MV3 separates host permissions from API permissions; MV2 has one list for both, so the reddit match joins the API permissions there rather than standing alone.',
	},
	{
		keys: ['optional_permissions', 'optional_host_permissions'],
		reason: 'The same split applied to the set requested at runtime rather than at install. On MV2 every optional endpoint sits beside the downloads permission in one list.',
	},
	{
		keys: ['web_accessible_resources'],
		reason: 'MV3 takes objects that scope each resource to the origins allowed to load it. MV2 takes bare paths, readable by any origin that knows the URL.',
	},
	{
		keys: ['browser_specific_settings', 'minimum_chrome_version'],
		reason: 'Where each store keeps its own metadata. AMO needs a stable add-on ID (sharing the one upstream RES uses would collide with an installed copy of it), a strict_min_version, and since 2025-11-03 an explicit data-collection declaration, without which submissions are auto-rejected. Chrome carries only its floor, as minimum_chrome_version.',
	},
];

export const TARGETS = ['chrome', 'firefox'];

export function manifestFor(target) {
	if (target === 'chrome') {
		return {
			manifest_version: 3,
			...SHARED,
			minimum_chrome_version: '__browser_min_version__',
			action: { default_icon: ACTION_ICON },
			background: { service_worker: 'background.entry.js' },
			content_security_policy: {
				extension_pages: [CSP_DIRECTIVES[0], CSP_SCRIPT_SRC, ...CSP_DIRECTIVES.slice(1)].join('; '),
			},
			permissions: PERMISSIONS,
			optional_permissions: ['downloads'],
			host_permissions: MATCHES,
			optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,
			web_accessible_resources: [{ resources: WEB_ACCESSIBLE_RESOURCES, matches: MATCHES }],
		};
	}

	if (target === 'firefox') {
		return {
			manifest_version: 2,
			...SHARED,
			browser_specific_settings: {
				gecko: {
					id: 'res-slim@sysadmindoc',
					data_collection_permissions: { required: ['none'] },
					strict_min_version: '__browser_min_version__',
				},
			},
			page_action: { default_icon: ACTION_ICON },
			background: { scripts: ['background.entry.js'] },
			content_security_policy: CSP_DIRECTIVES.join('; '),
			permissions: [...MATCHES, ...PERMISSIONS],
			optional_permissions: ['downloads', ...OPTIONAL_HOST_PERMISSIONS],
			web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,
		};
	}

	throw new Error(`Unknown manifest target: ${target}`);
}

export function serializeManifest(target) {
	// Tabs and a trailing newline, like every other tracked file here. `.gitattributes`
	// normalizes the line ending on the way into the index; this writes LF anyway
	// so the working copy matches on Windows too.
	return `${JSON.stringify(manifestFor(target), null, '\t')}\n`;
}
