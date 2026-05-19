import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const featureContext = read('lib/core/registry/featureContext.js');
const featureRegistry = read('lib/core/registry/featureRegistry.js');
const settingsSchema = read('lib/core/settings/schema.js');
const settingsDefaults = read('lib/core/settings/defaults.js');
const settingsMigrations = read('lib/core/settings/migrations.js');

const expectedSettings = [
	'rsm.core.registry.enabled',
	'rsm.core.toasts.enabled',
	'rsm.core.errorLog.enabled',
	'rsm.core.settingsBackup.enabled',
	'rsm.core.userscriptCompat.enabled',
	'rsm.theme.oled.enabled',
	'rsm.theme.accent.value',
	'rsm.theme.dense.enabled',
	'rsm.theme.glass.enabled',
	'rsm.theme.scrollbar.enabled',
	'rsm.theme.fullWidth.enabled',
	'rsm.theme.multiColumn.enabled',
	'rsm.theme.hideSidebar.enabled',
	'rsm.theme.sidebarRail.enabled',
	'rsm.theme.hideAwards.enabled',
	'rsm.theme.hideFlair.enabled',
	'rsm.theme.hideIcons.enabled',
	'rsm.theme.postNumbers.enabled',
	'rsm.theme.depthColors.enabled',
	'rsm.navigation.oldRedirect.enabled',
	'rsm.navigation.hostToggle.enabled',
	'rsm.navigation.infiniteScroll.enabled',
	'rsm.navigation.continueInline.enabled',
	'rsm.navigation.commentNavigator.enabled',
	'rsm.navigation.scrollRestore.enabled',
	'rsm.navigation.threadMinimap.enabled',
	'rsm.navigation.searchPersist.enabled',
	'rsm.navigation.searchDispatcher.enabled',
	'rsm.navigation.topCommentsPreview.enabled',
	'rsm.filters.subreddit.enabled',
	'rsm.filters.user.enabled',
	'rsm.filters.domain.enabled',
	'rsm.filters.keyword.enabled',
	'rsm.filters.flair.enabled',
	'rsm.filters.score.enabled',
	'rsm.filters.promoted.enabled',
	'rsm.filters.nsfwHide.enabled',
	'rsm.filters.nsfwUnblur.enabled',
	'rsm.filters.botCollapse.enabled',
	'rsm.filters.lowScoreCollapse.enabled',
	'rsm.filters.duplicates.enabled',
	'rsm.filters.aiSignal.enabled',
	'rsm.media.inlineImages.enabled',
	'rsm.media.inlineVideos.enabled',
	'rsm.media.posts.enabled',
	'rsm.media.comments.enabled',
	'rsm.media.fullHeight.enabled',
	'rsm.media.overlay.enabled',
	'rsm.media.nativeVideo.enabled',
	'rsm.media.downloadButtons.enabled',
	'rsm.media.galleryZip.enabled',
	'rsm.media.dashMux.enabled',
	'rsm.media.redgifsV3.enabled',
	'rsm.media.searchGallery.enabled',
	'rsm.moderation.workbench.enabled',
	'rsm.moderation.modbar.enabled',
	'rsm.moderation.queueTools.enabled',
	'rsm.moderation.userNotes.enabled',
	'rsm.moderation.removalReasons.enabled',
	'rsm.moderation.banMacros.enabled',
	'rsm.moderation.commentNuke.enabled',
	'rsm.privacy.outboundCleanser.enabled',
	'rsm.privacy.eventSabotage.enabled',
	'rsm.privacy.appPromptKiller.enabled',
	'rsm.privacy.ageBypass.enabled',
	'rsm.privacy.altFrontends.enabled',
	'rsm.privacy.usernameHider.enabled',
	'rsm.data.commentExport.enabled',
	'rsm.data.savedBackup.enabled',
	'rsm.data.historyLog.enabled',
	'rsm.data.filterBackup.enabled',
	'rsm.data.mediaManifest.enabled',
	'rsm.a11y.reducedMotion.enabled',
	'rsm.a11y.contrastGuard.enabled',
	'rsm.a11y.fontSize.value',
	'rsm.a11y.readableFont.enabled',
	'rsm.integrations.pullpush.enabled',
	'rsm.integrations.wayback.enabled',
	'rsm.integrations.archiveToday.enabled',
	'rsm.integrations.cobalt.enabled',
	'rsm.integrations.localCompanion.enabled',
	'rsm.integrations.localLlm.enabled',
	'rsm.qol.markdownToolbar.enabled',
	'rsm.qol.copyCode.enabled',
	'rsm.qol.commentDrafts.enabled',
	'rsm.qol.defaultSort.enabled',
	'rsm.qol.autoRefresh.enabled',
	'rsm.qol.memberCounts.enabled',
	'rsm.qol.disableAutoTranslate.enabled',
	'rsm.qol.base64Decoder.enabled',
	'rsm.qol.loginAutofillRepair.enabled',
	'rsm.qol.bannedBannerRemoval.enabled',
];

function settingDefinitionPattern(key) {
	const [, category, feature, setting] = key.split('.');
	return new RegExp(`category: '${category}', feature: '${feature}', setting: '${setting}'`);
}

test('feature registry exposes a reversible init/destroy lifecycle with isolated failures', () => {
	assert.match(featureRegistry, /createFeatureRegistry\(services = \{\}\)/);
	assert.match(featureRegistry, /const features = new Map\(\)/);
	assert.match(featureRegistry, /const running = new Map\(\)/);
	assert.match(featureRegistry, /register\(feature\)/);
	assert.match(featureRegistry, /async initFeature\(featureId\)/);
	assert.match(featureRegistry, /async destroyFeature\(featureId\)/);
	assert.match(featureRegistry, /async destroyAll\(\)/);
	assert.match(featureRegistry, /async applySetting\(key, value\)/);
	assert.match(featureRegistry, /getFeatureToggleKey\(feature\.id\)/);
	assert.match(featureRegistry, /getSettingDefault\(toggleKey\)/);
	assert.match(featureRegistry, /createFeatureContext\(feature, services\)/);
	assert.match(featureRegistry, /reportError\(feature, 'init', error\)/);
	assert.match(featureRegistry, /services\.toast/);
	assert.doesNotMatch(featureRegistry, /addEventListener\('keydown'/);
});

test('feature context centralizes cleanup for DOM, observers, timers, styles, and events', () => {
	assert.match(featureContext, /const cleanupStack = \[\]/);
	assert.match(featureContext, /let destroyed = false/);
	assert.match(featureContext, /cleanup\(fn\)/);
	assert.match(featureContext, /target\.addEventListener\(eventName, handler, options\)/);
	assert.match(featureContext, /target\.removeEventListener\(eventName, handler, options\)/);
	assert.match(featureContext, /new MutationObserver\(callback\)/);
	assert.match(featureContext, /observer\.disconnect\(\)/);
	assert.match(featureContext, /element\.classList\.add\(className\)/);
	assert.match(featureContext, /element\.classList\.remove\(className\)/);
	assert.match(featureContext, /style\.dataset\.rsmFeature = feature\.id/);
	assert.match(featureContext, /window\.clearTimeout\(timer\)/);
	assert.match(featureContext, /window\.clearInterval\(timer\)/);
	assert.match(featureContext, /if \(destroyed\) return/);
});

test('settings schema covers the roadmap storage keys and categories', () => {
	for (const category of ['core', 'theme', 'navigation', 'filters', 'media', 'moderation', 'privacy', 'data', 'a11y', 'integrations', 'qol']) {
		assert.match(settingsSchema, new RegExp(`id: '${category}'`));
	}

	for (const key of expectedSettings) {
		assert.match(settingsSchema, settingDefinitionPattern(key), `${key} exists in the schema`);
	}

	assert.match(settingsSchema, /key: `rsm\.\$\{definition\.category\}\.\$\{definition\.feature\}\.\$\{definition\.setting\}`/);
	assert.match(settingsSchema, /featureId: `\$\{definition\.category\}\.\$\{definition\.feature\}`/);
	assert.match(settingsSchema, /locked: true/);
	assert.match(settingsSchema, /external: true/);
	assert.match(settingsSchema, /destructive: true/);
	assert.match(settingsSchema, /legacyModuleID: 'showImages'/);
	assert.match(settingsSchema, /defaultValue: CURRENT_DEFAULT/);
	assert.match(settingsSchema, /defaultValue: AUTO_DEFAULT/);
	assert.doesNotMatch(settingsSchema, /keyboard/i);
});

test('settings defaults and migrations preserve current behavior, auto values, and unknown future keys', () => {
	assert.match(settingsDefaults, /resolveSettingDefault\(definition, currentValues = \{\}, environment = \{\}\)/);
	assert.match(settingsDefaults, /definition\.defaultValue === CURRENT_DEFAULT/);
	assert.match(settingsDefaults, /definition\.defaultValue === AUTO_DEFAULT/);
	assert.match(settingsDefaults, /environment\.prefersReducedMotion/);
	assert.match(settingsDefaults, /environment\.isUserscript/);
	assert.match(settingsDefaults, /Object\.fromEntries\(settingsSchema\.map/);
	assert.match(settingsDefaults, /mergeWithDefaults\(values = \{\}, options = \{\}\)/);

	assert.match(settingsMigrations, /CURRENT_SETTINGS_SCHEMA_VERSION = 1/);
	assert.match(settingsMigrations, /normalizeSettingsSnapshot\(snapshot, options = \{\}\)/);
	assert.match(settingsMigrations, /migrateSettingsSnapshot\(snapshot, options = \{\}\)/);
	assert.match(settingsMigrations, /value === 'on'/);
	assert.match(settingsMigrations, /value === 'off'/);
	assert.match(settingsMigrations, /extractKnownSettings\(snapshot, options = \{\}\)/);
	assert.match(settingsMigrations, /\.\.\.normalized\.values/);
});
