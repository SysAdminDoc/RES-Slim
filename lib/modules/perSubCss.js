/* @flow */
// RES-Slim: per-sub subreddit CSS allow/deny lists. A granular successor to
// disableSubredditStyles which is binary. Three global modes:
//   - allow-all (default keep, deny-list strips)
//   - deny-all (default strip, allow-list keeps)
//   - per-list (default keep, deny-list strips, allow-list documented)
// When enabled, do NOT also enable disableSubredditStyles unless you want
// the hard global kill regardless of lists.

import { Module } from '../core/module';
import {
	currentSubFromPath,
	normalizeMode,
	parseSubList,
	shouldStripStyles,
} from '../utils/perSubCss';

export const module: Module<{ [string]: any }> = new Module('perSubCss');

module.moduleName = 'Per-sub CSS allow/deny';
module.category = 'appearanceCategory';
module.description = 'Granular per-sub subreddit CSS control. Three modes: allow-all (deny list strips), deny-all (allow list keeps), per-list. Lists are comma- or newline-separated. Mutually exclusive with disableSubredditStyles.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['subreddit', 'css', 'stylesheet', 'allow', 'deny'];

module.options = {
	mode: {
		type: 'enum',
		value: 'per-list',
		title: 'Default behaviour',
		values: [
			{ name: 'Keep all subreddit CSS (deny list strips)', value: 'allow-all' },
			{ name: 'Strip all subreddit CSS (allow list keeps)', value: 'deny-all' },
			{ name: 'Per-list (deny strips, otherwise keep)', value: 'per-list' },
		],
		description: 'Global default for subs not in either list.',
	},
	denyList: {
		type: 'text',
		value: '',
		title: 'Deny list',
		description: 'Subs whose CSS should be stripped. Comma- or newline-separated. `/r/` prefix optional. Case-insensitive.',
	},
	allowList: {
		type: 'text',
		value: '',
		title: 'Allow list',
		description: 'Subs whose CSS should be kept (only relevant when mode is "deny-all" or as documentation in "per-list").',
	},
};

const STYLE_SELECTOR = 'link[title="applied_subreddit_stylesheet"], style[title="applied_subreddit_stylesheet"]';

let observer: MutationObserver | null = null;
let active = false;

function stripStyles(): void {
	const nodes = document.querySelectorAll(STYLE_SELECTOR);
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n instanceof HTMLLinkElement || n instanceof HTMLStyleElement) {
			n.setAttribute('disabled', 'disabled');
			n.remove();
		}
	}
}

function observeInjection(): void {
	if (observer || !document.head) return;
	// Declared `| null` but never disconnected: a second call orphaned the first
	// observer while leaving it running.
	if (observer) observer.disconnect();
	observer = new MutationObserver(() => {
		if (active) stripStyles();
	});
	observer.observe(document.head, { childList: true, subtree: true });
}

function decide(): boolean {
	const mode = normalizeMode(module.options.mode.value);
	const allow = parseSubList(module.options.allowList.value);
	const deny = parseSubList(module.options.denyList.value);
	const sub = currentSubFromPath(location.pathname);
	return shouldStripStyles(sub, mode, allow, deny);
}

module.beforeLoad = () => {
	active = decide();
	if (active) stripStyles();
	observeInjection();
};

module.contentStart = () => {
	active = decide();
	if (active) stripStyles();
	observeInjection();
};
