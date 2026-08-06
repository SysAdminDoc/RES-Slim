import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const categories = read('lib/constants/settingsCategories.js');
const template = read('lib/options/templates.js');
const controller = read('lib/options/settingsConsole.js');
const styles = read('lib/options/options.scss');
const locale = JSON.parse(read('locales/locales/en.json'));

const CATEGORY_ORDER = [...categories.matchAll(/'(\w+Category)',/g)].map(m => m[1]);

function declaredCategories() {
	const dir = path.join(repoRoot, 'lib/modules');
	const found = new Set();
	for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
		const match = read(`lib/modules/${file}`).match(/^module\.category = '([^']+)'/m);
		if (match) found.add(match[1]);
	}
	return found;
}

test('every category a module declares has a tab, in a declared order', () => {
	// A category missing from CATEGORY_ORDER sorts to indexOf === -1, which puts
	// it ahead of every listed category rather than dropping it. That is how
	// Privacy and About ended up above Comments in the old sidebar.
	for (const category of declaredCategories()) {
		assert.ok(
			CATEGORY_ORDER.includes(category),
			`${category} is declared by a module but missing from CATEGORY_ORDER — it would sort to the front`,
		);
	}
	assert.equal(new Set(CATEGORY_ORDER).size, CATEGORY_ORDER.length, 'CATEGORY_ORDER must not repeat a category');
});

test('every category tab has a translated label', () => {
	// i18n falls back to echoing the key, so a missing entry renders the raw
	// `privacyCategory` string in the UI rather than failing loudly.
	for (const category of declaredCategories()) {
		const message = locale[category]?.message;
		assert.equal(typeof message, 'string', `${category} should be localized`);
		assert.notEqual(message.trim(), '', `${category} should not be empty`);
		assert.doesNotMatch(message, /Category$/, `${category} looks like an untranslated key`);
	}
});

test('the console-preferences route cannot collide with a module', () => {
	const route = categories.match(/export const CONSOLE_PREFS_ROUTE = '([^']+)'/)?.[1];
	assert.equal(typeof route, 'string');

	const dir = path.join(repoRoot, 'lib/modules');
	for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
		const source = read(`lib/modules/${file}`);
		const moduleID = source.match(/new Module\('([^']+)'/)?.[1];
		if (!moduleID) continue;
		assert.notEqual(moduleID, route, `${file} claims the module ID reserved for the console tab route`);
	}
});

test('the tab strip is a real tablist, not styled buttons', () => {
	assert.match(template, /id="RESCategoryTabs"[\s\S]{0,160}role="tablist"/);
	assert.match(template, /class="categoryTab"[\s\S]{0,200}role="tab"/);
	assert.match(template, /aria-selected="false"/);
	assert.match(template, /aria-controls="RESModuleWorkspace"/);
	assert.match(template, /aria-controls="RESConsolePrefs"/);

	// role="tablist" promises arrow-key navigation and a single tab stop;
	// without both, assistive tech announces a widget that does not work.
	assert.match(controller, /NAMED_KEYS\.Right/);
	assert.match(controller, /NAMED_KEYS\.Left/);
	assert.match(controller, /NAMED_KEYS\.Home/);
	assert.match(controller, /NAMED_KEYS\.End/);
	assert.match(controller, /tab\.tabIndex = isSelected \? 0 : -1/);
});

test('the sidebar lists one category at a time', () => {
	// The whole point of the tabs: 99 modules in one scrolling column is the
	// thing being fixed, so the CSS must not fall back to showing them all.
	assert.match(styles, /\.RESConfigPanelCategory:not\(\.active\) \{ display: none; \}/);
	assert.match(controller, /querySelectorAll\('\.RESConfigPanelCategory\.active \.moduleRow'\)/);
});

test('filter chips count the open category, not the whole library', () => {
	assert.match(controller, /function modulesInActiveCategory\(\)/);
	assert.match(controller, /const scoped = modulesInActiveCategory\(\)/);
});

test('a category with staged changes stays marked while another tab is open', () => {
	// Save applies every staged change, not just the visible module's, so the
	// strip has to show where the rest of them are.
	assert.match(controller, /function updateCategoryTabStageMarkers\(\)/);
	assert.match(template, /categoryTabStageDot/);
	assert.match(styles, /\.categoryTabStageDot/);
});

test('reopening a category returns to the module you left', () => {
	assert.match(controller, /lastModuleByCategory/);
});

test('no pill radii on the new navigation', () => {
	const tabStyles = styles.slice(styles.indexOf('.categoryTabs {'), styles.indexOf('#RESConsoleContent {'));
	assert.doesNotMatch(tabStyles, /border-radius:[^;]*(999px|9999px|50%)/);
});
