/* @flow */

export const CURRENT_DEFAULT = 'current';
export const AUTO_DEFAULT = 'auto';

export const settingsCategories = Object.freeze([
	{ id: 'core', title: 'Core', order: 10 },
	{ id: 'theme', title: 'Theme', order: 20 },
	{ id: 'navigation', title: 'Navigation', order: 30 },
	{ id: 'filters', title: 'Filters', order: 40 },
	{ id: 'media', title: 'Media', order: 50 },
	{ id: 'moderation', title: 'Moderation', order: 60 },
	{ id: 'privacy', title: 'Privacy', order: 70 },
	{ id: 'data', title: 'Data', order: 80 },
	{ id: 'a11y', title: 'Accessibility', order: 90 },
	{ id: 'integrations', title: 'Integrations', order: 100 },
	{ id: 'qol', title: 'Quality of Life', order: 110 },
]);

export const settingsSchema = Object.freeze([
	{ category: 'core', feature: 'registry', setting: 'enabled', title: 'Feature registry', defaultValue: true, locked: true, notes: 'Cannot be disabled in UI.' },
	{ category: 'core', feature: 'toasts', setting: 'enabled', title: 'Toast host', defaultValue: true, notes: 'Required no-dialog feedback.' },
	{ category: 'core', feature: 'errorLog', setting: 'enabled', title: 'Error log panel', defaultValue: true, notes: 'Local only.' },
	{ category: 'core', feature: 'settingsBackup', setting: 'enabled', title: 'Settings import/export', defaultValue: true, notes: 'JSON only.' },
	{ category: 'core', feature: 'userscriptCompat', setting: 'enabled', title: 'Userscript compatibility mode', defaultValue: AUTO_DEFAULT, notes: 'Build-dependent.' },
	{ category: 'theme', feature: 'oled', setting: 'enabled', title: 'OLED theme', defaultValue: true, notes: 'Default visual baseline.' },
	{ category: 'theme', feature: 'accent', setting: 'value', title: 'Accent color', defaultValue: 'reddit-orange', notes: 'Stored token.' },
	{ category: 'theme', feature: 'dense', setting: 'enabled', title: 'Dense mode', defaultValue: false, notes: 'User opt-in.' },
	{ category: 'theme', feature: 'glass', setting: 'enabled', title: 'Glass panels', defaultValue: true, notes: 'Disable for reduced motion/perf if needed.' },
	{ category: 'theme', feature: 'scrollbar', setting: 'enabled', title: 'Branded scrollbar', defaultValue: true, notes: 'Scoped to Reddit pages.' },
	{ category: 'theme', feature: 'fullWidth', setting: 'enabled', title: 'Full-width content', defaultValue: false, notes: 'Per-page subkeys.' },
	{ category: 'theme', feature: 'multiColumn', setting: 'enabled', title: 'Multi-column feed', defaultValue: false, notes: 'Listing pages only.' },
	{ category: 'theme', feature: 'hideSidebar', setting: 'enabled', title: 'Hide sidebar', defaultValue: false, notes: 'Per subreddit override.' },
	{ category: 'theme', feature: 'sidebarRail', setting: 'enabled', title: 'Collapsible sidebar rail', defaultValue: false, notes: 'Mutually exclusive with hide sidebar.' },
	{ category: 'theme', feature: 'hideAwards', setting: 'enabled', title: 'Hide awards', defaultValue: false, notes: 'Listing/thread.' },
	{ category: 'theme', feature: 'hideFlair', setting: 'enabled', title: 'Hide flair', defaultValue: false, notes: 'User/link flair subkeys.' },
	{ category: 'theme', feature: 'hideIcons', setting: 'enabled', title: 'Hide avatars/icons', defaultValue: false, notes: 'Mostly new/sh compatibility.' },
	{ category: 'theme', feature: 'postNumbers', setting: 'enabled', title: 'Post numbers', defaultValue: false, notes: 'Listing.' },
	{ category: 'theme', feature: 'depthColors', setting: 'enabled', title: 'Color-coded depth', defaultValue: true, notes: 'Old-Reddit thread.' },
	{ category: 'navigation', feature: 'oldRedirect', setting: 'enabled', title: 'Old Reddit redirect', defaultValue: false, notes: 'Optional.' },
	{ category: 'navigation', feature: 'hostToggle', setting: 'enabled', title: 'Host toggle button', defaultValue: false, notes: 'Button only, no shortcut.' },
	{ category: 'navigation', feature: 'infiniteScroll', setting: 'enabled', title: 'Infinite scroll', defaultValue: CURRENT_DEFAULT, legacyModuleID: 'infiniteScroll', notes: 'Existing module.' },
	{ category: 'navigation', feature: 'continueInline', setting: 'enabled', title: 'Continue thread inline', defaultValue: true, notes: 'Thread.' },
	{ category: 'navigation', feature: 'commentNavigator', setting: 'enabled', title: 'Comment navigator buttons', defaultValue: CURRENT_DEFAULT, legacyModuleID: 'commentNavigator', notes: 'Remove feature shortcuts.' },
	{ category: 'navigation', feature: 'scrollRestore', setting: 'enabled', title: 'Scroll restore', defaultValue: true, notes: 'Per permalink.' },
	{ category: 'navigation', feature: 'threadMinimap', setting: 'enabled', title: 'Thread minimap', defaultValue: false, notes: 'Dense panel.' },
	{ category: 'navigation', feature: 'searchPersist', setting: 'enabled', title: 'Search filters persist', defaultValue: true, notes: 'Search pages.' },
	{ category: 'navigation', feature: 'searchDispatcher', setting: 'enabled', title: 'Search dispatcher', defaultValue: false, notes: 'External engines optional.' },
	{ category: 'navigation', feature: 'topCommentsPreview', setting: 'enabled', title: 'Top comments preview', defaultValue: false, notes: 'API use.' },
	{ category: 'filters', feature: 'subreddit', setting: 'enabled', title: 'Subreddit filter', defaultValue: CURRENT_DEFAULT, legacyModuleID: 'subredditBlacklist', notes: 'Restore resident cases.' },
	{ category: 'filters', feature: 'user', setting: 'enabled', title: 'User filter', defaultValue: false, notes: 'Local-only.' },
	{ category: 'filters', feature: 'domain', setting: 'enabled', title: 'Domain filter', defaultValue: false, notes: 'Local-only.' },
	{ category: 'filters', feature: 'keyword', setting: 'enabled', title: 'Keyword regex filter', defaultValue: false, notes: 'Weights: hide/dim/collapse.' },
	{ category: 'filters', feature: 'flair', setting: 'enabled', title: 'Flair filter', defaultValue: false, notes: 'Link/user flair.' },
	{ category: 'filters', feature: 'score', setting: 'enabled', title: 'Score filters', defaultValue: false, notes: 'Existing cases.' },
	{ category: 'filters', feature: 'promoted', setting: 'enabled', title: 'Promoted nuke', defaultValue: true, notes: 'DOM removal plus count.' },
	{ category: 'filters', feature: 'nsfwHide', setting: 'enabled', title: 'NSFW/spoiler hide', defaultValue: false, notes: 'Privacy preference.' },
	{ category: 'filters', feature: 'nsfwUnblur', setting: 'enabled', title: 'NSFW/spoiler unblur', defaultValue: false, optIn: true, notes: 'Opt-in.' },
	{ category: 'filters', feature: 'botCollapse', setting: 'enabled', title: 'Bot collapse', defaultValue: false, notes: 'Configurable names.' },
	{ category: 'filters', feature: 'lowScoreCollapse', setting: 'enabled', title: 'Low-score collapse', defaultValue: false, notes: 'Threshold setting.' },
	{ category: 'filters', feature: 'duplicates', setting: 'enabled', title: 'Duplicate detector', defaultValue: false, external: true, notes: 'API use.' },
	{ category: 'filters', feature: 'aiSignal', setting: 'enabled', title: 'AI/bot prose signal', defaultValue: false, notes: 'Local heuristics only.' },
	{ category: 'media', feature: 'inlineImages', setting: 'enabled', title: 'Inline images', defaultValue: CURRENT_DEFAULT, legacyModuleID: 'showImages', notes: 'Existing showImages.' },
	{ category: 'media', feature: 'inlineVideos', setting: 'enabled', title: 'Inline videos', defaultValue: CURRENT_DEFAULT, legacyModuleID: 'showImages', notes: 'Existing showImages.' },
	{ category: 'media', feature: 'posts', setting: 'enabled', title: 'Post media toggle', defaultValue: true, notes: 'Separate from comments.' },
	{ category: 'media', feature: 'comments', setting: 'enabled', title: 'Comment media toggle', defaultValue: true, notes: 'Community-requested split.' },
	{ category: 'media', feature: 'fullHeight', setting: 'enabled', title: 'Full-height images', defaultValue: false, notes: 'Listing/thread.' },
	{ category: 'media', feature: 'overlay', setting: 'enabled', title: 'Overlay viewer', defaultValue: false, notes: 'Escape/click close; no dialog.' },
	{ category: 'media', feature: 'nativeVideo', setting: 'enabled', title: 'Native video player', defaultValue: true, notes: 'When safe.' },
	{ category: 'media', feature: 'downloadButtons', setting: 'enabled', title: 'Download buttons', defaultValue: CURRENT_DEFAULT, legacyModuleID: 'downloadButtons', notes: 'Existing plus expansion.' },
	{ category: 'media', feature: 'galleryZip', setting: 'enabled', title: 'Gallery ZIP', defaultValue: false, optIn: true, notes: 'Downloads permission.' },
	{ category: 'media', feature: 'dashMux', setting: 'enabled', title: 'DASH mux', defaultValue: false, optIn: true, notes: 'Local/Cobalt/wasm strategy.' },
	{ category: 'media', feature: 'redgifsV3', setting: 'enabled', title: 'RedGifs v3', defaultValue: true, notes: 'Host-specific.' },
	{ category: 'media', feature: 'searchGallery', setting: 'enabled', title: 'Search gallery', defaultValue: false, notes: 'Search pages.' },
	{ category: 'moderation', feature: 'workbench', setting: 'enabled', title: 'Mod workbench', defaultValue: false, optIn: true, notes: 'Parent gate.' },
	{ category: 'moderation', feature: 'modbar', setting: 'enabled', title: 'Modbar', defaultValue: false, optIn: true, notes: 'Requires mod surface.' },
	{ category: 'moderation', feature: 'queueTools', setting: 'enabled', title: 'Queue tools', defaultValue: false, optIn: true, notes: 'Optional permissions.' },
	{ category: 'moderation', feature: 'userNotes', setting: 'enabled', title: 'User notes', defaultValue: false, optIn: true, notes: 'Local plus import.' },
	{ category: 'moderation', feature: 'removalReasons', setting: 'enabled', title: 'Removal reasons', defaultValue: false, destructive: true, notes: 'Write endpoint.' },
	{ category: 'moderation', feature: 'banMacros', setting: 'enabled', title: 'Ban macros', defaultValue: false, destructive: true, notes: 'Write endpoint.' },
	{ category: 'moderation', feature: 'commentNuke', setting: 'enabled', title: 'Comment nuke', defaultValue: false, destructive: true, notes: 'Destructive, toast undo where possible.' },
	{ category: 'privacy', feature: 'outboundCleanser', setting: 'enabled', title: 'Outbound link cleanser', defaultValue: true, notes: 'Mouseover/click.' },
	{ category: 'privacy', feature: 'eventSabotage', setting: 'enabled', title: 'Event tracker sabotage', defaultValue: true, notes: 'Safe only.' },
	{ category: 'privacy', feature: 'appPromptKiller', setting: 'enabled', title: 'App prompt killer', defaultValue: true, notes: 'No external calls.' },
	{ category: 'privacy', feature: 'ageBypass', setting: 'enabled', title: 'Mature/age bypass', defaultValue: false, optIn: true, notes: 'Opt-in.' },
	{ category: 'privacy', feature: 'altFrontends', setting: 'enabled', title: 'Alternate frontends', defaultValue: false, external: true, notes: 'Per service.' },
	{ category: 'privacy', feature: 'usernameHider', setting: 'enabled', title: 'Username hider', defaultValue: false, notes: 'Header.' },
	{ category: 'data', feature: 'commentExport', setting: 'enabled', title: 'Comment tree export', defaultValue: false, notes: 'JSON/MD/HTML.' },
	{ category: 'data', feature: 'savedBackup', setting: 'enabled', title: 'Saved backup', defaultValue: false, external: true, notes: 'API use.' },
	{ category: 'data', feature: 'historyLog', setting: 'enabled', title: 'Vote/read history', defaultValue: false, notes: 'Local IDB.' },
	{ category: 'data', feature: 'filterBackup', setting: 'enabled', title: 'Filters import/export', defaultValue: true, notes: 'JSON.' },
	{ category: 'data', feature: 'mediaManifest', setting: 'enabled', title: 'Media manifest', defaultValue: false, notes: 'Download workflows.' },
	{ category: 'a11y', feature: 'reducedMotion', setting: 'enabled', title: 'Reduced motion', defaultValue: AUTO_DEFAULT, notes: 'Mirrors OS by default.' },
	{ category: 'a11y', feature: 'contrastGuard', setting: 'enabled', title: 'Contrast guard', defaultValue: true, notes: 'Token tests.' },
	{ category: 'a11y', feature: 'fontSize', setting: 'value', title: 'Font size', defaultValue: 'default', notes: 'Range.' },
	{ category: 'a11y', feature: 'readableFont', setting: 'enabled', title: 'Dyslexia-readable font', defaultValue: false, notes: 'Optional.' },
	{ category: 'integrations', feature: 'pullpush', setting: 'enabled', title: 'PullPush', defaultValue: false, external: true, notes: 'External.' },
	{ category: 'integrations', feature: 'wayback', setting: 'enabled', title: 'Wayback', defaultValue: false, external: true, notes: 'External.' },
	{ category: 'integrations', feature: 'archiveToday', setting: 'enabled', title: 'archive.today', defaultValue: false, external: true, notes: 'External.' },
	{ category: 'integrations', feature: 'cobalt', setting: 'enabled', title: 'Cobalt', defaultValue: false, external: true, notes: 'External.' },
	{ category: 'integrations', feature: 'localCompanion', setting: 'enabled', title: 'Local companion', defaultValue: false, external: true, notes: 'localhost only.' },
	{ category: 'integrations', feature: 'localLlm', setting: 'enabled', title: 'Local LLM summary', defaultValue: false, external: true, notes: 'localhost/Ollama.' },
	{ category: 'qol', feature: 'markdownToolbar', setting: 'enabled', title: 'Markdown toolbar', defaultValue: true, notes: 'No shortcuts.' },
	{ category: 'qol', feature: 'copyCode', setting: 'enabled', title: 'Copy code block', defaultValue: true, notes: 'Toast.' },
	{ category: 'qol', feature: 'commentDrafts', setting: 'enabled', title: 'Comment drafts', defaultValue: true, notes: 'Local.' },
	{ category: 'qol', feature: 'defaultSort', setting: 'enabled', title: 'Default sort', defaultValue: false, notes: 'Per subreddit.' },
	{ category: 'qol', feature: 'autoRefresh', setting: 'enabled', title: 'Auto-refresh comments', defaultValue: false, notes: 'Backoff.' },
	{ category: 'qol', feature: 'memberCounts', setting: 'enabled', title: 'Member counts', defaultValue: true, legacyModuleID: 'restoreSubCounts', notes: 'Existing restore.' },
	{ category: 'qol', feature: 'disableAutoTranslate', setting: 'enabled', title: 'Disable auto-translation', defaultValue: true, notes: 'If detected.' },
	{ category: 'qol', feature: 'base64Decoder', setting: 'enabled', title: 'Base64 decoder', defaultValue: false, notes: 'Comment/post text.' },
	{ category: 'qol', feature: 'loginAutofillRepair', setting: 'enabled', title: 'Login autofill repair', defaultValue: false, notes: 'Needs capture.' },
	{ category: 'qol', feature: 'bannedBannerRemoval', setting: 'enabled', title: 'Banned banner removal', defaultValue: false, notes: 'If detected.' },
].map(definition => Object.freeze({
	...definition,
	key: `rsm.${definition.category}.${definition.feature}.${definition.setting}`,
	featureId: `${definition.category}.${definition.feature}`,
	type: definition.setting === 'enabled' ? 'boolean' : 'value',
})));

export const settingsByKey = Object.freeze(new Map(settingsSchema.map(definition => [definition.key, definition])));

export function getSettingDefinition(key) {
	return settingsByKey.get(key);
}

export function getSettingsByCategory(category) {
	return settingsSchema.filter(definition => definition.category === category);
}

export function getFeatureToggleKey(featureId) {
	const definition = settingsSchema.find(entry => entry.featureId === featureId && entry.setting === 'enabled');
	return definition && definition.key;
}

export function getFeatureIdForToggleKey(key) {
	const definition = getSettingDefinition(key);
	return definition && definition.setting === 'enabled' ? definition.featureId : null;
}

export function getSettingDefault(key) {
	const definition = getSettingDefinition(key);
	if (!definition) throw new Error(`Unknown setting key: ${key}`);
	return definition.defaultValue;
}

export function parseSettingKey(key) {
	const match = key.match(/^rsm\.([a-z0-9]+)\.([A-Za-z0-9]+)\.([A-Za-z0-9]+)$/);
	if (!match) return null;
	const [, category, feature, setting] = match;
	return { category, feature, setting, featureId: `${category}.${feature}` };
}
