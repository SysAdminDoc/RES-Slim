import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('permission prompt uses a structured premium approval surface', () => {
	const html = read('lib/environment/background/permissions/prompt.html');
	const entry = read('lib/environment/background/permissions/prompt.entry.js');

	assert.match(html, /class="permissionShell"/);
	assert.match(html, /class="permissionHeader"/);
	assert.match(html, /id="permissionSummary"/);
	assert.match(html, /id="permissionStatus"/);
	assert.match(html, /Grant access/);
	assert.match(html, /@media \(width <= 520px\)/);
	assert.match(entry, /function renderPermissionSummary\(\)/);
	assert.match(entry, /function setPromptStatus\(message: string/);
	assert.match(entry, /function finishPrompt\(result: boolean\)/);
	assert.match(entry, /document\.createElement\('li'\)/);
	assert.match(entry, /summary\.replaceChildren\(title, list\)/);
	assert.doesNotMatch(entry, /summary\.innerHTML/);
});

test('notifications use semantic controls and modern toast styling', () => {
	const notifications = read('lib/modules/notifications.js');
	const styles = read('lib/css/modules/_notifications.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(notifications, /role="status"/);
	assert.match(notifications, /<button type="button" class="RESCloseButton"/);
	assert.equal(locale.notificationsDismiss.message, 'Dismiss notification');
	assert.equal(locale.notificationsAlwaysShowType.message, 'Always show this type');
	assert.match(styles, /width: min\(360px, calc\(100vw - 24px\)\)/);
	assert.match(styles, /border-radius: 10px/);
	assert.match(styles, /box-shadow: 0 16px 42px/);
	assert.match(styles, /\.res-nightmode \{/);
	assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('floating media and comment navigation controls expose polished focus states', () => {
	const commentNav = read('lib/modules/commentNavigator.js');
	const commentNavStyles = read('lib/css/modules/_commentNavigator.scss');
	const showImagesStyles = read('lib/css/modules/_showImages.scss');

	assert.match(commentNav, /aria-label="Comment navigation"/);
	assert.match(commentNavStyles, /\.commentNavFieldLabel/);
	assert.match(commentNavStyles, /#commentNavButtons \{/);
	assert.match(commentNavStyles, /:focus-visible/);
	assert.match(showImagesStyles, /backdrop-filter: blur\(8px\)/);
	assert.match(showImagesStyles, /&:focus-within \.res-media-controls/);
	assert.match(showImagesStyles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('settings status feedback has premium busy and saved states', () => {
	const controller = read('lib/options/settingsConsole.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(styles, /&\.is-saved-pulse/);
	assert.match(styles, /&\.is-attention/);
	assert.match(styles, /&\[aria-busy='true'\] \.globalStageIcon/);
	assert.match(styles, /@keyframes spin/);
	assert.match(styles, /\.workspaceEmptyState \{/);
	assert.match(styles, /\.workspaceEmptyStateIcon/);
	assert.match(styles, /#moduleOptionsScrim \{/);
	assert.match(styles, /\.moduleOptionsScrimTitle/);
	assert.match(styles, /\.consoleControlGroup/);
	assert.match(styles, /\.enum \{/);
	assert.match(styles, /\.themeOptionSwatch--catppuccin/);
	assert.match(styles, /\.themeOptionSwatch--tokyonight/);
	assert.match(styles, /\.themeOptionSwatch--rosepine/);
	assert.match(controller, /function notifyCloseBlockedByUnsavedChanges\(\)/);
	assert.match(controller, /saveButton\.focus\(\)/);
	assert.match(controller, /settingsConsoleUnsavedCloseBlocked/);
	assert.doesNotMatch(controller, /Alert\.open\(getAbandonChangesConfirmation/);
	assert.equal(locale.settingsConsoleUnsavedCloseBlocked.message, 'Save or revert changes before closing.');
	assert.doesNotMatch(styles, /border-radius: 999px/);
	assert.doesNotMatch(styles, /backdrop-filter: blur\(4px\)/);
});
