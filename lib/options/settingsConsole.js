/* @flow */

import { markdown } from 'snudown-js';
import { mapValues, sortBy, groupBy, once } from '../utils/functional';
import { shortDescription } from '../utils/shortDescription';
import { Sortable } from '../vendor';
import * as Metadata from '../core/metadata';
import * as Modules from '../core/modules';
import { clearModuleErrorLog, getModuleErrorLog } from '../core/modules/storage';
import * as Options from '../core/options';
import {
	InvalidSnapshotError,
	applySnapshotGuarded,
	buildSnapshot,
	clearRestorePoint,
	describeDiff,
	loadRestorePoint,
	describeSnapshotOrigin,
	parseSnapshot,
	revertToRestorePoint,
	serializeSnapshot,
	suggestedFilename,
} from '../core/options/snapshot';
import {
	DEFAULT_SETTINGS_THEME,
	SETTINGS_THEME_PRESETS,
	SETTINGS_THEME_STORAGE_KEY,
	getSettingsThemeMetaColor,
	normalizeSettingsTheme,
} from '../constants/settingsThemes';
import {
	CATEGORY_ORDER,
	CATEGORY_TAB_LABEL_KEYS,
	CONSOLE_PREFS_ROUTE,
	CONSOLE_PREFS_TAB_ID,
	SEARCH_TAB_ID,
} from '../constants/settingsCategories';
import {
	Alert,
	CreateElement,
	NAMED_KEYS,
	caseBuilder,
	downcast,
	escapeHTML,
	frameThrottle,
	frameDebounce,
	niceKeyCode,
	watchForDescendants,
	closestHtml,
} from '../utils';
import { context, i18n, Permissions, getOptionsURL } from '../environment';
import { isTrustedConsoleOrigin } from '../utils/trustedOrigin';
import { showNotification } from '../modules/notifications';
import * as SettingsNavigation from '../modules/settingsNavigation';
import * as Search from '../modules/search';
import * as NightMode from '../modules/nightMode';
import { formatModuleErrorLog } from '../utils/moduleErrorLog';
import { clearSelectorDrift, readSelectorDrift } from '../core/dom/selectorDiagnostics';
import {
	countDriftedSurfaces,
	describeFinding,
	driftRecords,
	formatDriftReport,
} from '../utils/selectorDrift';
import { categoryTabsTemplate, consoleContainerTemplate, moduleSelectorTemplate } from './templates';

const DEFAULT_MODULE = NightMode.module;

let moduleOptionsScrimEl;
let RESConfigPanelOptions;
// Note: moduleOptionsScrimEl is now a native HTMLElement, not a jQuery wrapper
let RESConsoleContainer;
let RESConsoleContent;
let currentModule;
let lastNonSearchModule = DEFAULT_MODULE;
let moduleToggle;
let saveButton;
let discardButton;
let globalStageBar;
let mobileSidebarToggle;
let saveStatusTimer;
let closeBlockedStatusTimer;
let currentFilter: 'all' | 'enabled' | 'disabled' | 'modified' = 'all';
let isSavingOptions = false;
let activeCategory: ?string;
let categoryTabsEl;
let showingConsolePrefs = false;

const MOBILE_SIDEBAR_BREAKPOINT = 960;
const SETTINGS_DENSITY_STORAGE_KEY = 'res-settings-density';
const SETTINGS_DENSITY_DENSE = 'dense';
const SETTINGS_MOTION_STORAGE_KEY = 'res-settings-motion';
const SETTINGS_MOTION_REDUCE = 'reduce';
const FILTER_SUMMARY_KEYS = {
	enabled: ['settingsConsoleShowingEnabledOne', 'settingsConsoleShowingEnabledMany'],
	disabled: ['settingsConsoleShowingDisabledOne', 'settingsConsoleShowingDisabledMany'],
	modified: ['settingsConsoleShowingModifiedOne', 'settingsConsoleShowingModifiedMany'],
};
const MODULE_OPTIONS_INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]';

type SettingsTheme = string;
type SettingsDensity = 'comfortable' | 'dense';
type SettingsMotion = 'system' | 'reduce';

function pluralI18n(count: number, singularKey: string, pluralKey: string, ...substitutions: Array<string | number>) {
	return i18n(count === 1 ? singularKey : pluralKey, ...substitutions);
}

function getModuleToggleLabel(enabled: boolean, moduleName: string) {
	return i18n(enabled ? 'settingsConsoleDisableModuleAction' : 'settingsConsoleEnableModuleAction', moduleName);
}

function getModuleEnabled(moduleID: string): boolean {
	const stagedEnabled = Options.stage.getModule(moduleID);
	return typeof stagedEnabled === 'boolean' ? stagedEnabled : Modules.isEnabled(moduleID);
}

function getStoredSettingsTheme(): SettingsTheme {
	try {
		return normalizeSettingsTheme(localStorage.getItem(SETTINGS_THEME_STORAGE_KEY));
	} catch (e) {
		return DEFAULT_SETTINGS_THEME;
	}
}

function settingsToast(message: string, closeDelay: number = 2400) {
	showNotification({
		moduleID: 'settingsConsole',
		notificationID: 'settings-console-toast',
		message,
		closeDelay,
	}, closeDelay);
}

async function refreshModuleErrorLog() {
	const output = RESConsoleContainer && RESConsoleContainer.querySelector('#RESModuleErrorLogOutput');
	const status = RESConsoleContainer && RESConsoleContainer.querySelector('#RESModuleErrorLogStatus');
	const copy = RESConsoleContainer && RESConsoleContainer.querySelector('#RESModuleErrorLogCopy');
	const clear = RESConsoleContainer && RESConsoleContainer.querySelector('#RESModuleErrorLogClear');
	if (!(output instanceof HTMLTextAreaElement)) return;

	try {
		const entries = await getModuleErrorLog();
		output.value = formatModuleErrorLog(entries);
		output.placeholder = entries.length ? '' : i18n('settingsConsoleErrorsEmpty');
		if (copy instanceof HTMLButtonElement) copy.disabled = !entries.length;
		if (clear instanceof HTMLButtonElement) clear.disabled = !entries.length;
		if (status instanceof HTMLElement) status.textContent = entries.length ? i18n('settingsConsoleErrorsCount', entries.length) : '';
	} catch (e) {
		output.value = '';
		output.placeholder = i18n('settingsConsoleErrorsReadFailed');
		if (copy instanceof HTMLButtonElement) copy.disabled = true;
		if (clear instanceof HTMLButtonElement) clear.disabled = true;
		if (status instanceof HTMLElement) status.textContent = i18n('settingsConsoleErrorsReadFailed');
		console.error('RES-Slim: could not read module error log', e);
	}
}

async function copyModuleErrorLog() {
	const output = RESConsoleContainer && RESConsoleContainer.querySelector('#RESModuleErrorLogOutput');
	if (!(output instanceof HTMLTextAreaElement) || !output.value) return;
	try {
		if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard API unavailable');
		await navigator.clipboard.writeText(output.value);
		settingsToast(i18n('settingsConsoleErrorsCopySuccess'));
	} catch (e) {
		output.focus();
		output.select();
		settingsToast(i18n('settingsConsoleErrorsCopyFailed'));
	}
}

async function clearModuleErrors() {
	try {
		await clearModuleErrorLog();
		await refreshModuleErrorLog();
		settingsToast(i18n('settingsConsoleErrorsCleared'));
	} catch (e) {
		console.error('RES-Slim: could not clear module error log', e);
		settingsToast(i18n('settingsConsoleErrorsClearFailed'));
	}
}

function normalizeSettingsDensity(density: ?string): SettingsDensity {
	return density === SETTINGS_DENSITY_DENSE ? SETTINGS_DENSITY_DENSE : 'comfortable';
}

function getStoredSettingsDensity(): SettingsDensity {
	try {
		return normalizeSettingsDensity(localStorage.getItem(SETTINGS_DENSITY_STORAGE_KEY));
	} catch (e) {
		return 'comfortable';
	}
}

function updateThemeColorMeta(theme: SettingsTheme) {
	let metaTheme = document.querySelector('meta[name="theme-color"]');
	if (!(metaTheme instanceof HTMLMetaElement)) {
		metaTheme = document.createElement('meta');
		metaTheme.name = 'theme-color';
		document.head.append(metaTheme);
	}
	metaTheme.content = getSettingsThemeMetaColor(theme);
}

function syncThemeSelector(theme: SettingsTheme) {
	if (!(RESConsoleContainer instanceof HTMLElement)) return;
	for (const button of RESConsoleContainer.querySelectorAll('.themeOption')) {
		if (!(button instanceof HTMLButtonElement)) continue;
		const active = button.dataset.settingsTheme === theme;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', active ? 'true' : 'false');
	}
}

function syncDensityToggle(density: SettingsDensity) {
	if (!(RESConsoleContainer instanceof HTMLElement)) return;
	const button = RESConsoleContainer.querySelector('#RESDensityToggle');
	if (!(button instanceof HTMLButtonElement)) return;
	const dense = density === SETTINGS_DENSITY_DENSE;
	button.classList.toggle('is-active', dense);
	button.setAttribute('aria-pressed', dense ? 'true' : 'false');
	button.setAttribute('title', i18n(dense ? 'settingsConsoleDenseModeActive' : 'settingsConsoleDenseMode'));
	const value = button.querySelector('#RESDensityValue');
	if (value instanceof HTMLElement) value.textContent = i18n(dense ? 'settingsConsoleDensityDense' : 'settingsConsoleDensityComfortable');
}

function applySettingsTheme(theme: SettingsTheme, persist: boolean = true) {
	const nextTheme = normalizeSettingsTheme(theme);
	document.documentElement.dataset.settingsTheme = nextTheme;
	updateThemeColorMeta(nextTheme);
	syncThemeSelector(nextTheme);
	if (!persist) return;
	try {
		localStorage.setItem(SETTINGS_THEME_STORAGE_KEY, nextTheme);
	} catch (e) {
		// Ignore storage failures; the theme can still be applied for this session.
	}
	const preset = SETTINGS_THEME_PRESETS.find(p => p.id === nextTheme);
	settingsToast(i18n('settingsConsoleToastThemeApplied', preset ? i18n(preset.labelKey) : nextTheme));
}

function applySettingsDensity(density: SettingsDensity, persist: boolean = true) {
	const nextDensity = normalizeSettingsDensity(density);
	document.documentElement.dataset.settingsDensity = nextDensity;
	syncDensityToggle(nextDensity);
	if (!persist) return;
	try {
		localStorage.setItem(SETTINGS_DENSITY_STORAGE_KEY, nextDensity);
	} catch (e) {
		// Ignore storage failures; the density can still be applied for this session.
	}
	settingsToast(i18n(nextDensity === SETTINGS_DENSITY_DENSE ? 'settingsConsoleToastDensityDense' : 'settingsConsoleToastDensityComfortable'));
}

function normalizeSettingsMotion(motion: ?string): SettingsMotion {
	return motion === SETTINGS_MOTION_REDUCE ? SETTINGS_MOTION_REDUCE : 'system';
}

function getStoredSettingsMotion(): SettingsMotion {
	try {
		return normalizeSettingsMotion(localStorage.getItem(SETTINGS_MOTION_STORAGE_KEY));
	} catch (e) {
		return 'system';
	}
}

function syncMotionToggle(motion: SettingsMotion) {
	if (!(RESConsoleContainer instanceof HTMLElement)) return;
	const button = RESConsoleContainer.querySelector('#RESMotionToggle');
	if (!(button instanceof HTMLButtonElement)) return;
	const reduce = motion === SETTINGS_MOTION_REDUCE;
	button.classList.toggle('is-active', reduce);
	button.setAttribute('aria-pressed', reduce ? 'true' : 'false');
	button.setAttribute('title', i18n(reduce ? 'settingsConsoleReduceMotionActive' : 'settingsConsoleReduceMotion'));
	const value = button.querySelector('#RESMotionValue');
	if (value instanceof HTMLElement) value.textContent = i18n(reduce ? 'settingsConsoleMotionReduced' : 'settingsConsoleMotionSystem');
}

function applySettingsMotion(motion: SettingsMotion, persist: boolean = true) {
	const nextMotion = normalizeSettingsMotion(motion);
	if (nextMotion === SETTINGS_MOTION_REDUCE) {
		document.documentElement.dataset.reducedMotion = SETTINGS_MOTION_REDUCE;
	} else {
		delete document.documentElement.dataset.reducedMotion;
	}
	syncMotionToggle(nextMotion);
	if (!persist) return;
	try {
		localStorage.setItem(SETTINGS_MOTION_STORAGE_KEY, nextMotion);
	} catch (e) {
		// Ignore storage failures; the preference can still be applied for this session.
	}
	settingsToast(i18n(nextMotion === SETTINGS_MOTION_REDUCE ? 'settingsConsoleToastMotionReduced' : 'settingsConsoleToastMotionSystem'));
}

async function exportSettingsToFile(): Promise<void> {
	try {
		const snapshot = await buildSnapshot({ appVersion: Metadata.version });
		const blob = new Blob([serializeSnapshot(snapshot)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = suggestedFilename(snapshot);
		a.style.display = 'none';
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		showNotification({ moduleID: 'settingsBackup', message: i18n('settingsConsoleExportSuccess') }, 3000);
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		showNotification({ moduleID: 'settingsBackup', message: i18n('settingsConsoleExportFailed', reason) }, 6000);
		throw e;
	}
}

async function importSettingsFromFile(file: File): Promise<void> {
	try {
		const text = await file.text();
		const snapshot = parseSnapshot(text);
		// Backs the current settings up, applies, and rolls back on any failure.
		const origin = describeSnapshotOrigin(snapshot, Metadata.version);
		const { moduleCount, diff } = await applySnapshotGuarded(snapshot, { appVersion: Metadata.version });
		showNotification({
			moduleID: 'settingsBackup',
			// The origin note is what explains a surprising diff — a module the user
			// does not recognise appearing, or an option they never set changing —
			// without which the import reads as the extension inventing changes.
			message: `${i18n('settingsConsoleImportSuccess', moduleCount)} (${describeDiff(diff)}${origin ? `; ${origin}` : ''})`,
		}, 4000);
		// Reload so every module re-reads its options from storage with the imported
		// values. The undo affordance cannot live in this toast because the reload
		// destroys it, so the restore point is persisted and offered on next load.
		setTimeout(() => { location.reload(); }, 600);
	} catch (e) {
		const reason = e instanceof InvalidSnapshotError ? e.message : (e instanceof Error ? e.message : String(e));
		showNotification({ moduleID: 'settingsBackup', message: i18n('settingsConsoleImportFailed', reason) }, 8000);
		throw e;
	}
}

// Offered once, after the reload an import triggers. Without this the guarded
// apply would take a backup nobody could ever reach.
async function offerImportUndo(): Promise<void> {
	let restorePoint;
	try {
		restorePoint = await loadRestorePoint();
	} catch (e) {
		return;
	}
	if (!restorePoint) return;

	const wrapper = document.createElement('div');
	const summary = document.createElement('p');
	summary.style.margin = '0 0 8px';
	summary.textContent = 'Settings were imported. The state from before that import is still saved.';
	wrapper.append(summary);

	const undoBtn = document.createElement('button');
	undoBtn.type = 'button';
	undoBtn.className = 'RESNotificationButtonBlue';
	undoBtn.textContent = 'Undo import';
	undoBtn.addEventListener('click', async () => {
		undoBtn.disabled = true;
		undoBtn.textContent = 'Restoring…';
		try {
			const { moduleCount } = await revertToRestorePoint();
			showNotification({ moduleID: 'settingsBackup', message: `Restored ${moduleCount} module${moduleCount === 1 ? '' : 's'} from before the import.` }, 4000);
			setTimeout(() => { location.reload(); }, 600);
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			showNotification({ moduleID: 'settingsBackup', message: `Could not restore the pre-import settings: ${reason}` }, 8000);
		}
	}, { once: true });
	wrapper.append(undoBtn);

	const keepBtn = document.createElement('button');
	keepBtn.type = 'button';
	keepBtn.textContent = 'Keep imported';
	keepBtn.style.marginInlineStart = '8px';
	keepBtn.addEventListener('click', () => {
		keepBtn.disabled = true;
		clearRestorePoint().catch(() => {});
	}, { once: true });
	wrapper.append(keepBtn);

	showNotification({ moduleID: 'settingsBackup', header: 'Settings import', message: wrapper });
}

function isNarrowViewport() {
	return window.innerWidth <= MOBILE_SIDEBAR_BREAKPOINT;
}

function syncMobileSidebarToggle() {
	if (!(mobileSidebarToggle instanceof HTMLButtonElement) || !(RESConsoleContainer instanceof HTMLElement)) return;

	const collapsed = RESConsoleContainer.classList.contains('sidebar-collapsed');
	mobileSidebarToggle.hidden = !isNarrowViewport();
	mobileSidebarToggle.textContent = collapsed ? i18n('settingsConsoleShowModules') : i18n('settingsConsoleHideModules');
	mobileSidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function setSidebarCollapsed(collapsed: boolean) {
	if (!(RESConsoleContainer instanceof HTMLElement)) return;
	RESConsoleContainer.classList.toggle('sidebar-collapsed', collapsed && isNarrowViewport());
	syncMobileSidebarToggle();
}


export function start() {
	create();

	window.addEventListener('hashchange', loadFromHash);

	window.addEventListener('message', ({ origin, data }) => {
		// Only the embedding Reddit frame (content script) or the extension's own
		// standalone options page may drive console navigation. Without this guard any
		// cross-origin frame on the page (a media embed, an ad iframe) could postMessage
		// `load`/`close` into this privileged extension page.
		if (!isTrustedConsoleOrigin(origin, getOptionsURL().origin)) return;
		if (data.close) {
			close();
		} else if (data.load) {
			const { moduleID, optionKey } = data.load;
			load(moduleID, optionKey);
		}
	});

	loadFromHash();

	// An import reloads the page, so its undo cannot live in the toast that
	// reported it. Offer the restore point here instead.
	offerImportUndo();

	// Update all relative links to refer to Reddit
	watchForDescendants(document.body, 'a', e => {
		const a = downcast(e, HTMLAnchorElement);
		if (SettingsNavigation.isSettingsUrl(a.href)) return;
		a.href = new URL(e.getAttribute('href'), context.origin).href;
		// Redirect the top frame if not opening new tab
		if (!a.target.includes('_blank')) a.target = '_parent';
	});
}

function loadFromHash() {
	const { moduleID, optionKey } = SettingsNavigation.parseHash(location.hash);
	load(moduleID, optionKey);
	if (isNarrowViewport()) {
		setSidebarCollapsed(moduleID ? moduleID !== Search.module.moduleID : true);
	}
}

function load(moduleID, optionKey) {
	if (moduleID === CONSOLE_PREFS_ROUTE) {
		// Deep-linking straight to the console tab still needs a populated
		// sidebar behind it, so draw the default module first.
		if (!currentModule) load(DEFAULT_MODULE.moduleID);
		showConsolePrefs();
		SettingsNavigation.setHash(SettingsNavigation.makeUrlHash(CONSOLE_PREFS_ROUTE));
		return;
	}
	showConsolePrefs(false);

	const mod = (
		(moduleID && (
			Modules.getUnchecked(moduleID) ||
			Modules.getByCategory(moduleID)[0]
		)) ||
		DEFAULT_MODULE
	);

	if (mod !== Search.module) {
		lastNonSearchModule = mod;
	}

	if (mod !== currentModule) {
		currentModule = mod;
		drawConfigOptions(mod);
		updateSelectedModule(mod);
		requestAnimationFrame(() => {
			if (RESConfigPanelOptions instanceof HTMLElement) RESConfigPanelOptions.scrollTop = 0;
		});
	}

	if (optionKey && mod.options.hasOwnProperty(optionKey)) {
		highlightOption(mod, optionKey);
	}

	if (mod === Search.module) {
		Search.search(optionKey);
		requestAnimationFrame(() => Search.input().focus());
	} else {
		Search.input().blur();
	}

	SettingsNavigation.setHash(SettingsNavigation.makeUrlHash(moduleID, optionKey));
}

function showConsolePrefs(show: boolean = true) {
	if (showingConsolePrefs === show) return;
	showingConsolePrefs = show;

	const prefs = RESConsoleContainer.querySelector('#RESConsolePrefs');
	const workspace = RESConsoleContainer.querySelector('#RESModuleWorkspace');
	if (prefs instanceof HTMLElement) prefs.hidden = !show;
	if (workspace instanceof HTMLElement) workspace.hidden = show;
	RESConsoleContainer.classList.toggle('is-console-prefs', show);

	if (show) {
		updateConsoleBreadcrumb(i18n('settingsConsoleConsolePrefsTitle'));
		syncCategoryTabs(CONSOLE_PREFS_TAB_ID);
		if (prefs instanceof HTMLElement) prefs.setAttribute('aria-labelledby', 'RESCategoryTab-console');
	} else if (currentModule) {
		// `currentModule` does not change while the Console utility page is open.
		// Returning to that same module therefore skips drawConfigOptions(), so the
		// Console breadcrumb used to remain stuck even though the workspace and tab
		// had switched back. Restore both pieces of header state here.
		const isSearchWorkspace = currentModule === Search.module;
		updateConsoleBreadcrumb(
			isSearchWorkspace ? i18n('settingsConsoleTabSearch') : getCategoryLabel(currentModule.category),
			isSearchWorkspace ? i18n('aboutOptionsSearchSettingsTitle') : i18n(currentModule.moduleName),
		);
		syncCategoryTabs(isSearchWorkspace ? SEARCH_TAB_ID : activeCategory);
	}
}

function highlightOption(mod, optionKey) {
	const optionElement = RESConfigPanelOptions.querySelector(`#optionContainer-${mod.moduleID}-${optionKey}`);
	if (!optionElement) return;

	requestAnimationFrame(() => {
		optionElement.classList.add('highlight');
		optionElement.style.display = '';

		if (optionElement.classList.contains('advanced') && !SettingsNavigation.module.options.showAllOptions.value) {
			RESConsoleContainer.classList.add('advanced-options-enabled');
			showNotification(i18n('settingsConsoleAdvancedLinkOpenedNotice'), Infinity);
		}

		RESConfigPanelOptions.scrollTop = optionElement.offsetTop - 10;
	});
}

function create() {
	// create the console container
	RESConsoleContainer = consoleContainerTemplate({
		name: Metadata.name,
		version: Metadata.version,
		showAllOptions: SettingsNavigation.module.options.showAllOptions.value,
	});
	applySettingsTheme(getStoredSettingsTheme(), false);
	applySettingsDensity(getStoredSettingsDensity(), false);
	applySettingsMotion(getStoredSettingsMotion(), false);

	const RESClose = RESConsoleContainer.querySelector('#RESClose');
	RESClose.addEventListener('click', (e: Event) => {
		e.preventDefault();
		close();
	}, true);

	mobileSidebarToggle = ((RESConsoleContainer.querySelector('#RESMobileSidebarToggle'): any): HTMLButtonElement);
	mobileSidebarToggle.addEventListener('click', (e: Event) => {
		e.preventDefault();
		setSidebarCollapsed(!RESConsoleContainer.classList.contains('sidebar-collapsed'));
	}, true);

	const themeSelector = RESConsoleContainer.querySelector('#RESThemeSelector');
	if (themeSelector instanceof HTMLElement) {
		themeSelector.addEventListener('click', (e: Event) => {
			if (!(e.target instanceof Element)) return;
			const button = e.target.closest('.themeOption');
			if (!(button instanceof HTMLButtonElement)) return;
			applySettingsTheme(normalizeSettingsTheme(button.dataset.settingsTheme));
		}, true);
	}

	const densityToggle = RESConsoleContainer.querySelector('#RESDensityToggle');
	if (densityToggle instanceof HTMLButtonElement) {
		densityToggle.addEventListener('click', () => {
			const nextDensity = document.documentElement.dataset.settingsDensity === SETTINGS_DENSITY_DENSE ? 'comfortable' : SETTINGS_DENSITY_DENSE;
			applySettingsDensity(nextDensity);
		}, true);
	}

	const motionToggle = RESConsoleContainer.querySelector('#RESMotionToggle');
	if (motionToggle instanceof HTMLButtonElement) {
		motionToggle.addEventListener('click', () => {
			const nextMotion = document.documentElement.dataset.reducedMotion === SETTINGS_MOTION_REDUCE ? 'system' : SETTINGS_MOTION_REDUCE;
			applySettingsMotion(nextMotion);
		}, true);
	}

	const exportButton = RESConsoleContainer.querySelector('#RESSettingsExport');
	if (exportButton instanceof HTMLButtonElement) {
		exportButton.addEventListener('click', () => { exportSettingsToFile().catch(() => {}); }, true);
	}

	const importTrigger = RESConsoleContainer.querySelector('#RESSettingsImport');
	const importFile: ?HTMLInputElement = (RESConsoleContainer.querySelector('#RESSettingsImportFile'): any);
	if (importTrigger instanceof HTMLButtonElement && importFile instanceof HTMLInputElement) {
		importTrigger.addEventListener('click', () => importFile.click(), true);
		importFile.addEventListener('change', () => {
			const file = importFile.files && importFile.files[0];
			if (file) importSettingsFromFile(file).catch(() => {});
			importFile.value = '';
		}, true);
	}

	const errorLogRefresh = RESConsoleContainer.querySelector('#RESModuleErrorLogRefresh');
	if (errorLogRefresh instanceof HTMLButtonElement) errorLogRefresh.addEventListener('click', () => { refreshModuleErrorLog(); }, true);
	const errorLogCopy = RESConsoleContainer.querySelector('#RESModuleErrorLogCopy');
	if (errorLogCopy instanceof HTMLButtonElement) errorLogCopy.addEventListener('click', () => { copyModuleErrorLog(); }, true);
	const errorLogClear = RESConsoleContainer.querySelector('#RESModuleErrorLogClear');
	if (errorLogClear instanceof HTMLButtonElement) errorLogClear.addEventListener('click', () => { clearModuleErrors(); }, true);
	refreshModuleErrorLog();

	const RESAdvOptionsSpan = RESConsoleContainer.querySelector('#RESAllOptionsSpan');
	RESAdvOptionsSpan.setAttribute('title', i18n(SettingsNavigation.module.options.showAllOptions.description));

	const RESAdvOptions: HTMLInputElement = (RESAdvOptionsSpan.querySelector('input'): any);
	RESAdvOptions.addEventListener('change', () => {
		SettingsNavigation.module.options.showAllOptions.value = RESAdvOptions.checked;
		Options.save(SettingsNavigation.module.options.showAllOptions);
		RESConsoleContainer.classList.toggle('advanced-options-enabled', RESAdvOptions.checked);
		if (currentModule === Search.module) Search.search();
	}, true);

	// create the menu
	const menu = RESConsoleContainer.querySelector('#RESConfigPanelModulesList');
	menu.appendChild(renderModulesSelector());
	renderCategoryTabs();
	updateModuleStageMarkers();
	updateFilterChipCounts();
	applyModuleFilter();

	const modulesPane = RESConsoleContainer.querySelector('#RESConfigPanelModulesPane');
	if (modulesPane) {
		modulesPane.addEventListener('click', async (e: Event) => {
			const toggle = e.target instanceof Element && e.target.closest('.moduleRowToggle');
			if (toggle) {
				e.preventDefault();
				e.stopPropagation();
				const moduleID = toggle.getAttribute('data-module-toggle');
				if (!moduleID) return;
				await toggleModuleEnabled(moduleID);
				return;
			}
			const modBtn = closestHtml(e.target, '.moduleButton');
			if (modBtn) {
				const id = modBtn.dataset.module;
				if (id) {
					e.preventDefault();
					load(id);
					if (isNarrowViewport()) setSidebarCollapsed(true);
				}
			}
		});
	}

	// Global filter chips — live-filter the module list by state.
	const filterChips = RESConsoleContainer.querySelector('#RESFilterChips');
	if (filterChips) {
		filterChips.addEventListener('click', (e: Event) => {
			const chip = e.target instanceof Element && e.target.closest('.filterChip');
			if (!chip) return;
			e.preventDefault();
			const filter = chip.getAttribute('data-filter');
			if (filter === 'all' || filter === 'enabled' || filter === 'disabled' || filter === 'modified') {
				setModuleFilter(filter);
			}
		});
	}

	// Empty-state "Show all modules" reset button inside the sidebar.
	const modulesEmpty = RESConsoleContainer.querySelector('#RESConfigPanelModulesEmpty');
	if (modulesEmpty) {
		modulesEmpty.addEventListener('click', (e: Event) => {
			if (e.target instanceof Element && e.target.closest('.sidebarEmptyStateReset')) {
				e.preventDefault();
				setModuleFilter('all');
			}
		});
	}

	RESConsoleContent = RESConsoleContainer.querySelector('#RESConsoleContent');
	refreshSelectorDrift();

	RESConfigPanelOptions = RESConsoleContainer.querySelector('#RESConfigPanelOptions');

	const searchInputContainer = RESConsoleContainer.querySelector('#SearchRES-input-container');
	if (searchInputContainer) searchInputContainer.appendChild(Search.input());
	const search = () => {
		const rawQuery = Search.input().value;
		const query = rawQuery.trim();
		if (!query) {
			if (currentModule === Search.module && lastNonSearchModule) {
				load(lastNonSearchModule.moduleID);
			}
			return;
		}
		load(Search.module.moduleID, rawQuery);
	};
	Search.input().addEventListener('input', frameThrottle(search));
	Search.input().addEventListener('search', search);

	drawSettingsConsole();
	syncMobileSidebarToggle();
	window.addEventListener('resize', frameThrottle(syncMobileSidebarToggle));

	// Okay, the console is done. Add it to the document body.
	document.body.append(RESConsoleContainer);
}

const createKeyCodeModal = once(() => {
	const keyCodeModal = document.createElement('div');
	keyCodeModal.id = 'keyCodeModal';
	keyCodeModal.textContent = i18n('settingsConsoleKeycodePrompt');
	document.body.appendChild(keyCodeModal);
	let captureKey, captureKeyID;

	window.addEventListener('keydown', e => {
		if (captureKey && ![NAMED_KEYS.Shift, NAMED_KEYS.Control, NAMED_KEYS.Alt].includes(e.key)) {
			e.preventDefault();
			let keyArray;
			if (e.key === NAMED_KEYS.Backspace) {
				keyArray = [-1, false, false, false, false];
			} else {
				keyArray = [e.keyCode, e.altKey, e.ctrlKey, e.shiftKey, e.metaKey];
			}
			((RESConfigPanelOptions.querySelector(`[id="${captureKeyID}"]`): any): HTMLInputElement).value = keyArray.join(',');
			((RESConfigPanelOptions.querySelector(`[id="${captureKeyID}-display"]`): any): HTMLInputElement).value = niceKeyCode(keyArray);
			keyCodeModal.style.display = 'none';
			captureKey = false;
		}
	});

	if (RESConsoleContent) {
		RESConsoleContent.addEventListener('focus', (e: Event) => {
			if (!(e.target instanceof HTMLElement) || !e.target.matches('.keycode + input[type=text][displayonly]')) return;
			const target = e.target;
			const rect = target.getBoundingClientRect();
			keyCodeModal.style.display = 'block';
			keyCodeModal.style.top = `${rect.top + window.scrollY + target.offsetHeight}px`;
			keyCodeModal.style.left = `${rect.left + window.scrollX}px`;
			captureKey = true;
			captureKeyID = target.getAttribute('capturefor');
		}, true);
		RESConsoleContent.addEventListener('blur', (e: Event) => {
			if (!(e.target instanceof HTMLElement) || !e.target.matches('.keycode + input[type=text][displayonly]')) return;
			captureKey = false;
			keyCodeModal.style.display = 'none';
		}, true);
	}

	return keyCodeModal;
});

function renderModulesSelector() {
	function compareModules(a, b) {
		if (a.sort === b.sort) {
			return i18n(a.moduleName).toLocaleLowerCase().localeCompare(i18n(b.moduleName).toLocaleLowerCase());
		} else {
			return (a.sort || 0) - (b.sort || 0);
		}
	}

	const showCategories = Object.entries(
		groupBy(Modules.all().filter(mod => !mod.hidden), mod => mod.category),
	)
		.map(([category, modules]) => ({
			name: category,
			translatedName: i18n(category),
			modules: modules
				.sort(compareModules)
				.map(mod => {
					const descTemp = document.createElement('p'); descTemp.innerHTML = mod.descriptionRaw ? mod.description : markdown(i18n(mod.description)); const description = descTemp.textContent.replace(/\s+/g, ' ');

					return {
						moduleID: mod.moduleID,
						translatedName: i18n(mod.moduleName),
						description,
						shortDescription: shortDescription(description),
						isEnabled: Modules.isEnabled(mod),
						alwaysEnabled: !!mod.alwaysEnabled,
					};
				}),
		}));

	return moduleSelectorTemplate(sortBy(showCategories, ({ name }) => CATEGORY_ORDER.indexOf(name)));
}

function visibleModules() {
	return Modules.all().filter(mod => !mod.hidden);
}

function getCategoryLabel(category: string): string {
	return i18n(CATEGORY_TAB_LABEL_KEYS[category] || category);
}

function updateConsoleBreadcrumb(categoryLabel: string, moduleLabel: string = '') {
	if (!(RESConsoleContainer instanceof HTMLElement)) return;
	const category = RESConsoleContainer.querySelector('#RESBreadcrumbCategory');
	const moduleName = RESConsoleContainer.querySelector('#RESBreadcrumbModule');
	const separator = RESConsoleContainer.querySelector('.consoleBreadcrumbSeparator');
	const railHeading = RESConsoleContainer.querySelector('#RESHeaderCategory');
	if (railHeading instanceof HTMLElement) railHeading.textContent = categoryLabel;
	if (category instanceof HTMLElement) category.textContent = categoryLabel;
	if (moduleName instanceof HTMLElement) {
		moduleName.textContent = moduleLabel;
		moduleName.hidden = !moduleLabel;
	}
	if (separator instanceof HTMLElement) separator.hidden = !moduleLabel;
}

function categoriesInOrder(): Array<{| name: string, label: string, count: number |}> {
	const counts = new Map();
	for (const mod of visibleModules()) {
		counts.set(mod.category, (counts.get(mod.category) || 0) + 1);
	}
	// A category nobody declared has no tab; a category CATEGORY_ORDER forgot
	// would otherwise sort to the front, so it goes last and stays visible
	// rather than silently disappearing.
	const known = CATEGORY_ORDER.filter(name => counts.has(name));
	const unlisted = [...counts.keys()].filter(name => !CATEGORY_ORDER.includes(name)).sort();
	return [...known, ...unlisted].map(name => ({
		name,
		label: getCategoryLabel(name),
		count: counts.get(name) || 0,
	}));
}

function renderCategoryTabs() {
	categoryTabsEl = RESConsoleContainer.querySelector('#RESCategoryTabs');
	if (!(categoryTabsEl instanceof HTMLElement)) return;
	categoryTabsEl.appendChild(categoryTabsTemplate(categoriesInOrder()));

	categoryTabsEl.addEventListener('click', (e: Event) => {
		const tab = e.target instanceof Element && e.target.closest('.categoryTab');
		if (!(tab instanceof HTMLButtonElement)) return;
		e.preventDefault();
		activateTab(tab.dataset.category);
	});

	// role="tablist" carries an arrow-key contract: without it the strip reads
	// as a tab widget to assistive tech but does not behave like one. This is
	// scoped to a focused tab, not a page-level shortcut.
	categoryTabsEl.addEventListener('keydown', (e: KeyboardEvent) => {
		const tab = e.target instanceof Element && e.target.closest('.categoryTab');
		if (!(tab instanceof HTMLButtonElement)) return;
		const tabs = selectableTabs();
		const index = tabs.indexOf(tab);
		if (index === -1) return;

		let nextIndex;
		switch (e.key) {
			case NAMED_KEYS.Down:
			case NAMED_KEYS.Right: nextIndex = (index + 1) % tabs.length; break;
			case NAMED_KEYS.Up:
			case NAMED_KEYS.Left: nextIndex = (index - 1 + tabs.length) % tabs.length; break;
			case NAMED_KEYS.Home: nextIndex = 0; break;
			case NAMED_KEYS.End: nextIndex = tabs.length - 1; break;
			default: return;
		}

		e.preventDefault();
		tabs[nextIndex].focus();
		activateTab(tabs[nextIndex].dataset.category);
	});
}

function selectableTabs(): Array<HTMLButtonElement> {
	if (!(categoryTabsEl instanceof HTMLElement)) return [];
	return (Array.from(categoryTabsEl.querySelectorAll('.categoryTab')): Array<any>)
		.filter(tab => tab instanceof HTMLButtonElement && !tab.hidden);
}

function activateTab(category: ?string) {
	if (!category) return;
	if (category === CONSOLE_PREFS_TAB_ID) {
		load(CONSOLE_PREFS_ROUTE);
		return;
	}
	if (category === SEARCH_TAB_ID) {
		load(Search.module.moduleID, Search.input().value.trim() || undefined);
		return;
	}
	const [first] = Modules.getByCategory(category).filter(mod => !mod.hidden);
	if (!first) return;
	// Reopening a category returns you to whichever of its modules you were
	// last on, rather than snapping back to the first one every time.
	const remembered = lastModuleByCategory.get(category);
	load(remembered && Modules.getUnchecked(remembered) ? remembered : first.moduleID);
}

const lastModuleByCategory: Map<string, string> = new Map();

function syncCategoryTabs(selected: ?string) {
	if (!(categoryTabsEl instanceof HTMLElement)) return;
	for (const tab of categoryTabsEl.querySelectorAll('.categoryTab')) {
		if (!(tab instanceof HTMLButtonElement)) continue;
		const isSelected = tab.dataset.category === selected;
		tab.classList.toggle('is-active', isSelected);
		tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
		// Roving tabindex: one stop for the whole strip.
		tab.tabIndex = isSelected ? 0 : -1;
	}
	// Nothing selected (a hidden module opened by deep link) still needs one
	// reachable tab stop.
	const selectedTab = categoryTabsEl.querySelector('.categoryTab[aria-selected="true"]');
	if (!selectedTab) {
		const [first] = selectableTabs();
		if (first) first.tabIndex = 0;
	} else if (selectedTab instanceof HTMLElement) {
		revealTab(selectedTab);
	}
}

// Below ~960px the strip scrolls sideways, so a deep link or an arrow-key move
// can select a tab that is off-screen. Nudge the strip rather than the page.
function revealTab(tab: HTMLElement) {
	if (!(categoryTabsEl instanceof HTMLElement)) return;
	const scroller = categoryTabsEl.querySelector('.categoryTabsInner');
	if (!(scroller instanceof HTMLElement) || scroller.scrollWidth <= scroller.clientWidth) return;

	const tabRect = tab.getBoundingClientRect();
	const boxRect = scroller.getBoundingClientRect();
	const padding = 12;
	if (tabRect.left < boxRect.left) {
		scroller.scrollLeft -= (boxRect.left - tabRect.left) + padding;
	} else if (tabRect.right > boxRect.right) {
		scroller.scrollLeft += (tabRect.right - boxRect.right) + padding;
	}
}

function updateCategoryTabStageMarkers() {
	if (!(categoryTabsEl instanceof HTMLElement)) return;
	const staged = new Set();
	for (const mod of visibleModules()) {
		if (getModuleStageCount(mod.moduleID) > 0) staged.add(mod.category);
	}
	for (const tab of categoryTabsEl.querySelectorAll('.categoryTab')) {
		if (!(tab instanceof HTMLElement)) continue;
		const category = tab.dataset.category;
		const dot = tab.querySelector('.categoryTabStageDot');
		if (!category || !(dot instanceof HTMLElement)) continue;
		const hasStaged = staged.has(category);
		dot.hidden = !hasStaged;
		tab.classList.toggle('has-staged-changes', hasStaged);
		const baseLabel = tab.getAttribute('data-base-aria-label') || tab.getAttribute('aria-label') || '';
		if (baseLabel) {
			if (!tab.hasAttribute('data-base-aria-label')) tab.setAttribute('data-base-aria-label', baseLabel);
			tab.setAttribute('aria-label', hasStaged ? `${baseLabel}${i18n('settingsConsoleTabStagedSuffix')}` : baseLabel);
		}
	}
}

function setActiveCategory(category: ?string) {
	activeCategory = category;
	syncCategoryTabs(category);

	const title = RESConsoleContainer.querySelector('#RESActiveCategoryTitle');
	if (title instanceof HTMLElement) {
		title.textContent = category ? getCategoryLabel(category) : i18n('settingsConsoleModulesTitle');
	}

	for (const group of RESConsoleContainer.querySelectorAll('.RESConfigPanelCategory')) {
		if (!(group instanceof HTMLElement)) continue;
		group.classList.toggle('active', group.dataset.category === category);
	}

	updateFilterChipCounts();
	applyModuleFilter();
}

function updateSelectedModule(mod) {
	const items = RESConsoleContainer.querySelectorAll('.moduleButton');
	let selectedElement = null;

	for (const item of items) {
		if (item.dataset.module === mod.moduleID) {
			item.classList.add('active');
			item.setAttribute('aria-current', 'page');
			selectedElement = item;
		} else {
			item.classList.remove('active');
			item.removeAttribute('aria-current');
		}
	}
	const moduleList = RESConsoleContainer.querySelector('#RESConfigPanelModulesList');
	if (selectedElement && moduleList instanceof HTMLElement) {
		const listRect = moduleList.getBoundingClientRect();
		const itemRect = selectedElement.getBoundingClientRect();
		const padding = 8;
		if (itemRect.top < listRect.top) {
			moduleList.scrollTop -= (listRect.top - itemRect.top) + padding;
		} else if (itemRect.bottom > listRect.bottom) {
			moduleList.scrollTop += (itemRect.bottom - listRect.bottom) + padding;
		}
	}

	const searchTab = RESConsoleContainer.querySelector('#RESCategoryTab-search');
	const isSearchWorkspace = mod === Search.module;
	if (searchTab instanceof HTMLElement) searchTab.hidden = !isSearchWorkspace;

	if (isSearchWorkspace) {
		// Search spans every category, so no category tab is the right answer;
		// the results tab stands in until the query is cleared.
		syncCategoryTabs(SEARCH_TAB_ID);
	} else {
		lastModuleByCategory.set(mod.category, mod.moduleID);
		setActiveCategory(mod.category);
	}
}

function updateCurrentModuleState(mod) {
	const enabled = getModuleEnabled(mod.moduleID);
	const stateBadge = RESConsoleContainer.querySelector('#moduleStateBadge');
	if (stateBadge) {
		const isSearchWorkspace = mod === Search.module;
		stateBadge.hidden = isSearchWorkspace;
		const stateText = mod.alwaysEnabled ? i18n('settingsConsoleStateAlwaysOn') : enabled ? i18n('settingsConsoleStateEnabled') : i18n('settingsConsoleStateDisabled');
		stateBadge.textContent = stateText;
		stateBadge.classList.toggle('is-enabled', enabled && !isSearchWorkspace);
		stateBadge.classList.toggle('is-disabled', !enabled && !mod.alwaysEnabled && !isSearchWorkspace);
		stateBadge.classList.toggle('is-locked', mod.alwaysEnabled && !isSearchWorkspace);
	}

	if (moduleToggle) {
		moduleToggle.style.display = mod.alwaysEnabled ? 'none' : '';
		moduleToggle.classList.toggle('enabled', enabled);
		moduleToggle.dataset.module = mod.moduleID;
		moduleToggle.setAttribute('aria-label', getModuleToggleLabel(enabled, i18n(mod.moduleName)));
		moduleToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
		moduleToggle.setAttribute('title', getModuleToggleLabel(enabled, i18n(mod.moduleName)));
	}

	// Keep configuration available while a module is off so users can prepare
	// its settings before enabling it. The module switch still controls runtime
	// activation; it no longer turns the workspace into a blocked overlay.
	if (moduleOptionsScrimEl) moduleOptionsScrimEl.classList.remove('visible');
	syncModuleOptionsInteractivity(true);
}

function syncModuleOptionsInteractivity(enabled: boolean) {
	const allOptionsContainer = RESConfigPanelOptions && RESConfigPanelOptions.querySelector('#allOptionsContainer');
	if (!(allOptionsContainer instanceof HTMLElement)) return;

	allOptionsContainer.toggleAttribute('inert', !enabled);

	for (const element of allOptionsContainer.querySelectorAll(MODULE_OPTIONS_INTERACTIVE_SELECTOR)) {
		if (!(element instanceof HTMLElement) || element.id === 'moduleOptionsScrim' || element.closest('#moduleOptionsScrim')) continue;

		if (!enabled) {
			if (!element.hasAttribute('data-res-console-tabindex')) {
				element.setAttribute('data-res-console-tabindex', element.getAttribute('tabindex') || '');
			}
			element.setAttribute('tabindex', '-1');

			if (
				element instanceof HTMLButtonElement ||
				element instanceof HTMLInputElement ||
				element instanceof HTMLSelectElement ||
				element instanceof HTMLTextAreaElement
			) {
				if (!element.hasAttribute('data-res-console-disabled')) {
					element.setAttribute('data-res-console-disabled', String(element.disabled));
				}
				element.disabled = true;
			}
		} else {
			if (element.hasAttribute('data-res-console-tabindex')) {
				const originalTabIndex = element.getAttribute('data-res-console-tabindex');
				if (originalTabIndex) element.setAttribute('tabindex', originalTabIndex);
				else element.removeAttribute('tabindex');
				element.removeAttribute('data-res-console-tabindex');
			}

			if (
				(element instanceof HTMLButtonElement ||
				element instanceof HTMLInputElement ||
				element instanceof HTMLSelectElement ||
				element instanceof HTMLTextAreaElement) &&
				element.hasAttribute('data-res-console-disabled')
			) {
				element.disabled = element.getAttribute('data-res-console-disabled') === 'true';
				element.removeAttribute('data-res-console-disabled');
			}
		}
	}
}

function getModuleStageCount(moduleID) {
	const stagedOptions = Options.stage.get(moduleID);
	const optionCount = stagedOptions ? Object.keys(stagedOptions).length : 0;
	const moduleCount = typeof Options.stage.getModule(moduleID) === 'boolean' ? 1 : 0;
	return optionCount + moduleCount;
}

function updateModuleStageMarkers() {
	for (const btn of RESConsoleContainer.querySelectorAll('.moduleButton')) {
		const moduleID = String(btn.dataset.module);
		const stagedCount = getModuleStageCount(moduleID);
		const hasStagedChanges = stagedCount > 0;
		const stageBadge = btn.querySelector('.moduleButtonStage');
		btn.classList.toggle('has-staged-changes', hasStagedChanges);

		if (stageBadge instanceof HTMLElement) {
			stageBadge.hidden = !hasStagedChanges;
			stageBadge.textContent = pluralI18n(stagedCount, 'settingsConsoleStagedCountOne', 'settingsConsoleStagedCountMany', stagedCount);
		}
	}
}

function updateModuleLibrarySummary(visibleRowCount?: number) {
	const scoped = modulesInActiveCategory();
	const shownModuleCount = typeof visibleRowCount === 'number' ? visibleRowCount : scoped.length;
	const enabledCount = scoped.filter(mod => getModuleEnabled(mod.moduleID)).length;
	const stagedModuleCount = scoped.filter(mod => getModuleStageCount(mod.moduleID) > 0).length;
	const moduleCountBadge = RESConsoleContainer.querySelector('#RESModuleCountBadge');
	const moduleLibraryMeta = RESConsoleContainer.querySelector('#RESModuleLibraryMeta');
	// With one category open the useful summary is how much of it is switched
	// on, not how many categories exist. Under a chip filter, say what the
	// filter is showing instead.
	const countSummary = currentFilter === 'all' ?
		i18n('settingsConsoleCategoryEnabledMeta', enabledCount, scoped.length) :
		pluralI18n(shownModuleCount, FILTER_SUMMARY_KEYS[currentFilter][0], FILTER_SUMMARY_KEYS[currentFilter][1], shownModuleCount);
	const stagedSummary = stagedModuleCount ? ` • ${pluralI18n(stagedModuleCount, 'settingsConsoleStagedModulesOne', 'settingsConsoleStagedModulesMany', stagedModuleCount)}` : '';

	if (moduleCountBadge instanceof HTMLElement) {
		moduleCountBadge.textContent = `${shownModuleCount}`;
		moduleCountBadge.setAttribute('aria-label', pluralI18n(shownModuleCount, 'settingsConsoleModuleCountLabelOne', 'settingsConsoleModuleCountLabelMany', shownModuleCount));
	}

	if (moduleLibraryMeta instanceof HTMLElement) {
		moduleLibraryMeta.textContent = `${countSummary}${stagedSummary}`;
	}
}

function getModuleOptionSummary(mod, optionCount, advancedCount) {
	if (!optionCount) {
		return mod.alwaysEnabled ? i18n('settingsConsoleNoConfigurableOptionsAlwaysOn') : i18n('settingsConsoleNoConfigurableOptions');
	}

	const optionSummary = pluralI18n(optionCount, 'settingsConsoleSettingCountOne', 'settingsConsoleSettingCountMany', optionCount);
	const advancedSummary = advancedCount ? i18n('settingsConsoleAdvancedCount', advancedCount) : '';
	const stateSummary = mod.alwaysEnabled ? i18n('settingsConsoleAlwaysOnSuffix') : '';
	return `${optionSummary}${advancedSummary}${stateSummary}`;
}

function getWorkspaceStageSummary(changeCount, scopeCount) {
	if (!changeCount) {
		return i18n('settingsConsoleAllChangesSaved');
	}

	return scopeCount > 1 ?
		pluralI18n(changeCount, 'settingsConsoleChangeStagedScopeOne', 'settingsConsoleChangeStagedScopeMany', changeCount, scopeCount) :
		pluralI18n(changeCount, 'settingsConsoleChangeStagedOne', 'settingsConsoleChangeStagedMany', changeCount);
}

// The DOM id of a rendered control, and the label that names it.
//
// Ids used to be the bare option key, so two modules that both call an option
// `enabled` produced two elements with the same id — and, for enum options, two
// radio *groups* with the same `name`, which the platform merges into one. Only
// one module renders at a time today, so it was latent rather than broken, but
// it is the sort of latent that turns into a bug the day a panel shows two
// modules at once.
//
// Which option a control belongs to is now carried by `data-option-key` instead
// of being parsed back out of the id. That is the real fix: the id is a DOM
// address and the option key is application data, and reading one as the other
// is why namespacing them was a breaking change in the first place.
export function optionDomId(moduleID: string, optionName: string): string {
	return `${moduleID}-${optionName}`;
}

function optionLabelId(moduleID: string, optionName: string): string {
	return `${moduleID}-${optionName}-label`;
}

// Option types whose control is not a labelable element, so `<label for>` names
// nothing: an enum renders a radiogroup, a button option a group, a boolean a
// custom switch. Each points `aria-labelledby` back at the option title instead.
// A `keycode` is labelable but has two inputs — the label goes to the visible
// one, not to the `display: none` one behind it.
const LABELLED_BY_ARIA = new Set(['enum', 'button', 'boolean']);

function drawOptionInput(mod, optionName, optionObject, isTable) {
	let thisOptionFormEle;
	const domId = optionDomId(mod.moduleID, optionName);
	const labelId = optionLabelId(mod.moduleID, optionName);
	function _ce(tag, attrs = {}) {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) {
			if (k === 'class' || k === 'className') el.className = String(v);
			else el.setAttribute(k, String(v));
		}
		return el;
	}
	switch (optionObject.type) {
		case 'textarea':
			thisOptionFormEle = _ce('textarea', { id: domId, type: 'textarea', moduleID: mod.moduleID });
			thisOptionFormEle.innerHTML = escapeHTML(optionObject.value);
			break;
		case 'list':
		case 'text':
		case 'hidden':
			thisOptionFormEle = _ce('input', { id: domId, type: optionObject.type === 'hidden' ? 'hidden' : 'text', moduleID: mod.moduleID });
			if (typeof optionObject.value !== 'undefined') thisOptionFormEle.setAttribute('value', optionObject.value);
			break;
		case 'color':
			thisOptionFormEle = _ce('input', { id: domId, type: 'color', moduleID: mod.moduleID });
			if (typeof optionObject.value !== 'undefined') ((thisOptionFormEle: any): HTMLInputElement).value = optionObject.value;
			break;
		case 'button': {
			const { values = [], callback, text } = optionObject;
			if (callback && text) values.push({ callback, text });
			// A bare div with an id the outer `<label for>` pointed at — which labels
			// nothing, because a div is not a labelable element. A group with an
			// accessible name is what a screen reader can actually announce.
			const buttonsContainer = thisOptionFormEle = _ce('div', { id: domId, role: 'group' });
			buttonsContainer.setAttribute('aria-labelledby', labelId);
			for (const option of values) {
				let btnEl;
				if (typeof option.callback === 'string' || option.callback.moduleID) {
					btnEl = _ce('a');
				} else {
					btnEl = _ce('button');
				}
				btnEl.classList.add('RESConsoleButton');
				btnEl.setAttribute('moduleID', mod.moduleID);
				if (option.text.tagName) {
					btnEl.appendChild(option.text);
				} else if (typeof option.text === 'string') {
					btnEl.textContent = i18n(option.text);
				} else {
					btnEl.appendChild(CreateElement.icon(0xF141));
				}
				if (option.callback.moduleID) {
					btnEl.setAttribute('href', SettingsNavigation.makeUrlHash(option.callback.moduleID, option.callback.optionKey));
				} else if (typeof option.callback === 'string') {
					btnEl.setAttribute('href', option.callback);
					btnEl.setAttribute('target', '_blank');
					btnEl.setAttribute('rel', 'noopener noreferrer');
				} else if (typeof option.callback === 'function') {
					btnEl.addEventListener('click', async function() {
						if (this.classList.contains('csspinner')) return;
						this.classList.add('csspinner');
						try { await option.callback(optionName, optionObject); } catch (e) { if (e.message) Alert.open(e.message); console.error(e); }
						this.classList.remove('csspinner');
					});
				}
				buttonsContainer.appendChild(btnEl);
			}
			break;
		}
		case 'password':
			thisOptionFormEle = _ce('input', { id: domId, type: 'password', moduleID: mod.moduleID });
			if (typeof optionObject.value !== 'undefined') thisOptionFormEle.setAttribute('value', optionObject.value);
			break;
		case 'boolean': {
			const toggleEl = CreateElement.toggleButton(
				() => { RESConsoleContainer.dispatchEvent(new Event('change', { bubbles: true })); },
				domId, optionObject.value, undefined, undefined, isTable,
			);
			thisOptionFormEle = toggleEl;
			thisOptionFormEle.setAttribute(
				isTable ? 'aria-label' : 'aria-labelledby',
				isTable ? i18n(optionObject.name || optionName) : labelId,
			);
			break;
		}
		case 'enum':
			// `<label for>` pointed at this div, which labels nothing. A radiogroup
			// with an accessible name is the shape assistive technology expects, and
			// it is what makes the individual radios announce as "1 of 5".
			thisOptionFormEle = _ce('div', { id: domId, class: 'enum', role: 'radiogroup' });
			thisOptionFormEle.setAttribute('aria-labelledby', labelId);
			if (optionObject.value && !optionObject.values.some(({ value }) => value === optionObject.value)) {
				optionObject.values.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
			}
			optionObject.values.forEach((optionValue, index) => {
				const thisId = `${domId}-${index}`;
				// The `name` is namespaced along with the id: two modules sharing an
				// option key would otherwise render two radio groups the platform
				// treats as one, so selecting in either would clear the other.
				const radio = _ce('input', { id: thisId, type: 'radio', name: domId, moduleID: mod.moduleID, value: optionValue.value });
				radio.dataset.optionKey = optionName;
				if (isTable) radio.setAttribute('tableOption', 'true');
				const nullEqualsEmpty = ((optionObject.value === null) && (optionValue.value === ''));
				if ((optionObject.value === optionValue.value) || nullEqualsEmpty) radio.setAttribute('checked', 'checked');
				const thisLabel = document.createElement('label');
				thisLabel.setAttribute('for', thisId);
				thisLabel.textContent = ` ${i18n(optionValue.name)} `;
				thisOptionFormEle.append(radio, thisLabel, document.createElement('br'));
			});
			break;
		case 'keycode': {
			createKeyCodeModal();
			const realInput = _ce('input', { id: domId, type: 'text', class: 'keycode', moduleID: mod.moduleID });
			realInput.style.border = '1px solid red';
			realInput.style.display = 'none';
			(realInput: any).value = optionObject.value;
			if (isTable) realInput.setAttribute('tableOption', 'true');
			// The outer `<label for>` used to point at the hidden input above, so the
			// field the user can actually see and focus had no accessible name at
			// all. It is labelled directly now, and the label points here.
			const displayInput = _ce('input', { id: `${domId}-display`, type: 'text', capturefor: domId, displayonly: 'true' });
			// Only outside a table: inside one there is no `optionTitle` label to point
			// at, so `aria-labelledby` would name the field after an element that does
			// not exist — an empty accessible name that looks like a labelled field.
			// The table branch below gives it the column name instead.
			if (!isTable) displayInput.setAttribute('aria-labelledby', labelId);
			(displayInput: any).value = niceKeyCode(optionObject.value);
			thisOptionFormEle = _ce('div');
			thisOptionFormEle.append(realInput, displayInput);
			break;
		}
		case 'select':
			thisOptionFormEle = _ce('select', { id: domId, class: 'select' });
			if (optionObject.value && !optionObject.values.some(({ value }) => value === optionObject.value)) {
				optionObject.values.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
			}
			optionObject.values.forEach((optionValue, index) => {
				const thisId = `${domId}-${index}`;
				const opt = _ce('option', { id: thisId, class: 'select-option', value: optionValue.value, moduleID: mod.moduleID });
				if (optionValue.style) opt.setAttribute('style', optionValue.style);
				opt.textContent = optionValue.name;
				const nullEqualsEmpty = ((optionObject.value === null) && (optionValue.value === ''));
				if ((optionObject.value === optionValue.value) || nullEqualsEmpty) opt.setAttribute('selected', 'selected');
				thisOptionFormEle.appendChild(opt);
			});
			break;
		default:
			throw new Error(`modules.${mod.moduleID}.options.${optionName} has invalid type: ${optionObject.type}`);
	}
	if (isTable) {
		thisOptionFormEle.setAttribute('tableOption', 'true');
		// A cell in an options table has no visible label of its own — the column
		// header is the only thing naming it, and a header is not associated with
		// the cells beneath it for a control that is not in a real table row
		// relationship. Booleans already did this; every other type in a table
		// rendered an unnamed control, which is most of the cells in
		// `commentTools`, `filteReddit` and the keyboard-shortcut tables.
		const columnName = i18n(optionObject.name || optionName);
		if (columnName && !thisOptionFormEle.hasAttribute('aria-label')) {
			thisOptionFormEle.setAttribute('aria-label', columnName);
		}
		for (const input of thisOptionFormEle.querySelectorAll('input, select, textarea')) {
			if (!input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) {
				input.setAttribute('aria-label', columnName);
			}
		}
	}
	// Which option this control belongs to, stated rather than parsed back out of
	// an id. Set on the control and on every input inside it, so staging can read
	// it without caring which of the eleven option types it is looking at.
	thisOptionFormEle.dataset.optionKey = optionName;
	for (const input of thisOptionFormEle.querySelectorAll('input, select, textarea')) {
		if (!input.dataset.optionKey) input.dataset.optionKey = optionName;
	}
	return thisOptionFormEle;
}

async function toggleModuleEnabled(moduleID: string) {
	const mod = Modules.getUnchecked(moduleID);
	if (!mod || mod.alwaysEnabled) return;

	const enable = !getModuleEnabled(moduleID);
	if (enable) {
		const { requiredPermissions: permissions, message } = Modules.get(moduleID).permissions;
		if (permissions.length && !await Permissions.has(permissions)) {
			if (message) {
				showNotification({
					header: i18n('settingsConsolePermissionRequired'),
					moduleID,
					closeDelay: 20000,
					message,
				});
			}
			await Permissions.request(permissions);
			if (!await Permissions.has(permissions)) return;
		}
	}

	Options.stage.addModule(moduleID, enable);
	syncSidebarModuleState(moduleID, enable);
	if (currentModule && currentModule.moduleID === moduleID) {
		updateCurrentModuleState(Modules.get(moduleID));
	}
	updateSaveButton();
	updateFilterChipCounts();
	applyModuleFilter();
	settingsToast(i18n(enable ? 'settingsConsoleToastModuleEnabled' : 'settingsConsoleToastModuleDisabled', i18n(mod.moduleName)));
}

function syncSidebarModuleState(moduleID: string, enabled: boolean) {
	const row = RESConsoleContainer.querySelector(`.moduleRow[data-module-id="${moduleID}"]`);
	if (!row) return;
	row.classList.toggle('is-enabled', enabled);
	const btn = row.querySelector('.moduleButton');
	if (btn) btn.classList.toggle('enabled', enabled);
	const rowToggle = row.querySelector('.moduleRowToggle');
	if (rowToggle instanceof HTMLElement) {
		rowToggle.classList.toggle('is-on', enabled);
		rowToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
		const moduleTitle = row.querySelector('.moduleButtonTitle');
		const moduleName = moduleTitle instanceof HTMLElement ? moduleTitle.textContent || moduleID : moduleID;
		const newLabel = getModuleToggleLabel(enabled, moduleName);
		rowToggle.setAttribute('aria-label', newLabel);
		rowToggle.setAttribute('title', newLabel);
	}
}

function drawSettingsConsole() {
	// Per-module toggle mirror in the workspace header — kept for discoverability
	// while viewing a module's options. Delegates to the shared toggleModuleEnabled.
	const thisToggle = RESConsoleContainer.querySelector('.moduleToggle');
	moduleToggle = thisToggle;

	thisToggle.addEventListener('click', async function() {
		const moduleID = this.dataset.module;
		if (moduleID) await toggleModuleEnabled(moduleID);
	}, true);

	// Global save button in the top bar — applies every staged change at once.
	saveButton = ((RESConsoleContainer.querySelector('#RESGlobalSave'): any): HTMLButtonElement);
	saveButton.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		await saveAllStagedOptions();
	}, true);

	// Global discard button — drops every staged change and refreshes the workspace.
	discardButton = ((RESConsoleContainer.querySelector('#RESGlobalDiscard'): any): HTMLButtonElement);
	discardButton.addEventListener('click', (e: Event) => {
		e.preventDefault();
		discardAllStagedOptions();
	}, true);

	globalStageBar = RESConsoleContainer.querySelector('#RESGlobalStageBar');

	document.body.addEventListener('keyup', handleEscapeKey);
	window.addEventListener('beforeunload', handleBeforeUnload);
	RESConsoleContainer.addEventListener('input', autostageDebounce);
	RESConsoleContainer.addEventListener('change', autostageDebounce);
	// Advice is recomputed from the live form, not from saved values, because the
	// thing it warns about is usually a *combination* — an accent that is fine on
	// the palette you saved and unreadable on the one you just picked.
	RESConsoleContainer.addEventListener('input', refreshOptionAdvice);
	RESConsoleContainer.addEventListener('change', refreshOptionAdvice);
}

async function saveAllStagedOptions() {
	if (isSavingOptions) return;
	// The workspace autostages on input, so current-module edits are already
	// in the stage by the time Save is clicked. Just commit.
	if (currentModule) stageCurrentModuleOptions();
	if (!Options.stage.isDirty()) {
		updateSaveButton();
		return;
	}

	isSavingOptions = true;
	updateSaveButton();

	try {
		await Options.stage.commit();
	} catch (e) {
		console.error('RES-Slim: saving options failed', e);
		isSavingOptions = false;
		updateSaveButton();
		showNotification({
			moduleID: 'settingsNavigation',
			notificationID: 'optionsSaveFailed',
			message: `Saving options failed: ${String((e && e.message) || e)}`,
			closeDelay: 10000,
		}, 10000);
		return;
	}
	isSavingOptions = false;
	// Re-sync sidebar toggle state with the committed reality — modules that
	// were staged may have resolved differently.
	for (const mod of Modules.all().filter(m => !m.hidden)) {
		syncSidebarModuleState(mod.moduleID, Modules.isEnabled(mod));
	}
	updateSaveButton();
	updateFilterChipCounts();
	applyModuleFilter();
	notifyOptionsSaved();
	settingsToast(i18n('settingsConsoleToastSaved'));
}

function discardAllStagedOptions() {
	const hadStaged = Options.stage.isDirty();
	Options.stage.reset();
	// Redraw the current module so any form inputs revert to their saved values.
	if (currentModule) drawConfigOptions(currentModule);
	for (const mod of Modules.all().filter(m => !m.hidden)) {
		syncSidebarModuleState(mod.moduleID, Modules.isEnabled(mod));
	}
	updateSaveButton();
	updateFilterChipCounts();
	applyModuleFilter();
	if (hadStaged) settingsToast(i18n('settingsConsoleToastReverted'));
}

// --- inline option advice --------------------------------------------------
//
// An option can declare `advise(value, values) -> ?{ message, suggestion }`, and
// the console renders the result under the control. This exists because some
// values are only wrong in combination: a hex accent is syntactically valid at
// any darkness, and only the palette chosen in the option above it decides
// whether it is readable. Type validation cannot see that, and a silent
// correction at paint time would leave the settings page showing a colour the
// page does not use.
//
// `suggestion` is optional and, when present, is offered as a one-click fix
// rather than applied — the user picked that colour on purpose.

const optionAdviceEntries = [];

function liveOptionValues(mod) {
	const values = {};
	for (const [key, option] of Object.entries(getOptions(mod))) values[key] = (option: any).value;

	// Overlay whatever the form currently shows so advice tracks unsaved edits.
	for (const key of Object.keys(values)) {
		const radio = RESConfigPanelOptions.querySelector(`input[type="radio"][data-option-key="${CSS.escape(key)}"]:checked`);
		if (radio instanceof HTMLInputElement) {
			values[key] = radio.value;
			continue;
		}
		const input = RESConfigPanelOptions.querySelector(`[data-option-key="${CSS.escape(key)}"]`);
		if (input instanceof HTMLInputElement) {
			values[key] = input.type === 'checkbox' ? input.checked : input.value;
		}
	}
	return values;
}

function attachOptionAdvice(container, mod, optionKey, option) {
	if (typeof option.advise !== 'function') return;

	const note = document.createElement('p');
	note.className = 'optionAdvice';
	// `status` rather than `alert`: this fires on every keystroke of a colour
	// picker drag, and an assertive live region would talk over the user.
	note.setAttribute('role', 'status');
	note.hidden = true;

	const text = document.createElement('span');
	text.className = 'optionAdviceText';

	const action = document.createElement('button');
	action.type = 'button';
	action.className = 'RESConsoleButton optionAdviceAction';
	action.hidden = true;

	note.append(text, action);
	container.appendChild(note);
	optionAdviceEntries.push({ mod, optionKey, option, note, text, action });
}

function refreshOptionAdvice() {
	if (!optionAdviceEntries.length) return;
	const values = liveOptionValues(optionAdviceEntries[0].mod);

	for (const entry of optionAdviceEntries) {
		let advice = null;
		try {
			advice = entry.option.advise(values[entry.optionKey], values);
		} catch (e) {
			// Advice is a courtesy; a broken one must not take the settings page
			// down with it.
			console.error('RES-Slim: option advice failed for', entry.optionKey, e);
		}

		entry.note.hidden = !advice;
		if (!advice) continue;

		entry.text.textContent = advice.message;
		const suggestion = advice.suggestion;
		entry.action.hidden = !suggestion;
		if (!suggestion) continue;

		entry.action.textContent = suggestion.label;
		entry.action.onclick = () => {
			const input = RESConfigPanelOptions.querySelector(`[data-option-key="${CSS.escape(entry.optionKey)}"]`);
			if (input instanceof HTMLInputElement) {
				input.value = suggestion.value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
				input.focus();
			}
		};
	}
}

function drawConfigOptions(mod) {
	const isSearchWorkspace = mod === Search.module;
	if (mod.hidden && !isSearchWorkspace) return;
	const thisOptions = getOptions(mod);
	const configurableOptions = Object.entries(thisOptions).filter(([, option]) => !option.noconfig);
	const advancedOptionCount = configurableOptions.filter(([, option]) => option.advanced).length;
	let optCount = 0;
	RESConfigPanelOptions.dataset.module = mod.moduleID;
	RESConsoleContainer.classList.toggle('is-search-workspace', isSearchWorkspace);

	const thisModuleName = RESConsoleContainer.querySelector('.moduleName');
	thisModuleName.innerHTML = isSearchWorkspace ?
		i18n('aboutOptionsSearchSettingsTitle') :
		`${i18n(mod.moduleName)} <span class="moduleKey" translate="no">${mod.moduleID}</span>`;
	const thisModuleCategory = RESConsoleContainer.querySelector('.moduleCategoryBadge');
	thisModuleCategory.textContent = isSearchWorkspace ? i18n('settingsConsoleWorkspace') : i18n(mod.category);
	updateConsoleBreadcrumb(
		isSearchWorkspace ? i18n('settingsConsoleTabSearch') : getCategoryLabel(mod.category),
		isSearchWorkspace ? i18n('aboutOptionsSearchSettingsTitle') : i18n(mod.moduleName),
	);
	const moduleOptionSummary = RESConsoleContainer.querySelector('#moduleOptionSummary');
	moduleOptionSummary.textContent = isSearchWorkspace ?
		i18n('settingsConsoleWorkspaceSummary') :
		getModuleOptionSummary(mod, configurableOptions.length, advancedOptionCount);

	updateCurrentModuleState(mod);

	updateSaveButton();

	const thisDescription = RESConsoleContainer.querySelector('.moduleDescription');
	thisDescription.innerHTML = isSearchWorkspace ? Search.descriptionMarkup() : mod.descriptionRaw ? mod.description : markdown(i18n(mod.description));
	const contextNote = RESConsoleContainer.querySelector('#RESModuleContextNote');
	if (contextNote instanceof HTMLElement) {
		const showPrivacyNote = !isSearchWorkspace && mod.category === 'privacyCategory';
		contextNote.hidden = !showPrivacyNote;
		contextNote.textContent = showPrivacyNote ? i18n('settingsConsolePrivacyLocalNote') : '';
	}

	const allOptionsContainer = RESConsoleContainer.querySelector('#allOptionsContainer');
	while (allOptionsContainer.firstChild) allOptionsContainer.removeChild(allOptionsContainer.firstChild);
	// The notes belong to the rows being torn down; keeping them would leave
	// `refreshOptionAdvice` writing into detached nodes for every module visited.
	optionAdviceEntries.length = 0;
	// now draw all the options...
	allOptionsContainer.append(...Object.entries(thisOptions).map(([optionKey, option]) => {
		if (option.noconfig) return;

		let thisOptionFormEle;
		optCount++;
		const containerID = `optionContainer-${mod.moduleID}-${optionKey}`;
		const thisOptionContainer = document.createElement('div');
		thisOptionContainer.id = containerID;
		thisOptionContainer.className = 'optionContainer';

		if (option.dependsOn && !option.dependsOn(thisOptions)) {
			thisOptionContainer.classList.add('dependsOnDisabledOptions');
		}

		if (option.advanced) {
			thisOptionContainer.classList.add('advanced');
			thisOptionContainer.setAttribute('data-advanced-label', i18n('settingsConsoleAdvancedTag'));
		}

		const optionTitle = i18n(option.title);

		const thisLabel = document.createElement('label');
		thisLabel.id = optionLabelId(mod.moduleID, optionKey);
		thisLabel.className = 'optionTitle';
		// `for` only where it can land on something labelable. An enum renders a
		// radiogroup, a button option renders a group, and a boolean renders a
		// custom switch — none of them is a labelable element, so pointing `for` at
		// them named nothing. Those three carry `aria-labelledby` back to this
		// label instead, and a keycode's `for` goes to the field the user can see
		// rather than to the hidden one behind it.
		const forId = LABELLED_BY_ARIA.has(option.type) ? null :
			option.type === 'keycode' ? `${optionDomId(mod.moduleID, optionKey)}-display` :
			optionDomId(mod.moduleID, optionKey);
		if (forId) thisLabel.setAttribute('for', forId);
		thisLabel.innerHTML = `${optionTitle}<br /><span class="optionKey">${optionKey}</span>`;

		let niceDefaultOption = null;
		switch (option.type) {
			case 'textarea':
			case 'text':
			case 'password':
			case 'list':
				niceDefaultOption = option.default;
				break;
			case 'color':
				niceDefaultOption = option.default;
				if (option.default.startsWith('#')) {
					niceDefaultOption += ` (R:${parseInt(option.default.substr(1, 2), 16)}, G:${parseInt(option.default.substr(3, 2), 16)}, B:${parseInt(option.default.substr(5, 2), 16)})`;
				}
				break;
			case 'boolean':
				niceDefaultOption = option.default ? 'on' : 'off';
				break;
			case 'enum':
			case 'select':
				const matchingOption = option.values.find(({ value }) => option.default === value);
				niceDefaultOption = matchingOption && i18n(matchingOption.name);
				break;
			case 'keycode':
				niceDefaultOption = niceKeyCode(option.default);
				break;
			default:
				break;
		}
		if (niceDefaultOption !== null) {
			thisLabel.title = i18n('settingsConsoleDefaultValue', niceDefaultOption);
		}
		const thisOptionDescription = document.createElement('div');
		thisOptionDescription.className = 'optionDescription';
		thisOptionDescription.innerHTML = markdown(i18n(option.description));
		const thisOptionSetting = document.createElement('div');
		thisOptionSetting.className = 'optionSetting';
		if (option.type === 'boolean') {
			thisOptionSetting.classList.add('toggleSetting');
		}
		thisOptionContainer.append(thisLabel, thisOptionSetting);
		if (option.type === 'table') {
			const isFixed = option.addRowText === false; // set addRowText value to false to disable additing/removing/moving of row
			thisOptionContainer.classList.add('table');
			const thisTbody = document.createElement('tbody');
			// table - has a list of fields (headers of table), users can add/remove rows...
			const thisTable = document.createElement('table');
			thisTable.setAttribute('moduleID', mod.moduleID);
			thisTable.setAttribute('optionName', optionKey);
			thisTable.setAttribute('class', 'optionsTable');
			// Don't allow very long tables to make further option too far down
			if (option.value.length > 67) thisOptionSetting.classList.add('wholeTableVisible');
			const thisThead = document.createElement('thead');
			const thisTableHeader = document.createElement('tr');
			let thisTH;
			thisTable.appendChild(thisThead);
			option.fields.forEach(field => {
				thisTH = document.createElement('th');
				thisTH.textContent = i18n(field.name);
				thisTableHeader.appendChild(thisTH);
				if (field.type === 'hidden') thisTH.hidden = true;
			});
			if (!isFixed) {
				// add delete column
				thisTH = document.createElement('th');
				thisTableHeader.appendChild(thisTH);
				// add move column
				thisTH = document.createElement('th');
				thisTableHeader.prepend(thisTH);
			}
			thisThead.appendChild(thisTableHeader);
			thisTable.appendChild(thisThead);
			thisTbody.setAttribute('id', `tbody_${optionKey}`);
			thisTbody.append(...option.value.map((thisValue, j) => {
				const thisTR = document.createElement('tr');
				option.fields.forEach((field, k) => {
					const thisTD = document.createElement('td');
					thisTD.className = 'hasTableOption';
					const thisOpt = {
						...field,
						value: thisValue[k],
					};
					const thisFullOpt = `${optionKey}_${thisOpt.name}`;
					const thisOptInputName = `${thisFullOpt}_${j}`;
					const thisTableEle = drawOptionInput(mod, thisOptInputName, thisOpt, true);
					thisTD.appendChild(thisTableEle);
					if (thisOpt.type === 'hidden') thisTD.hidden = true;
					thisTR.appendChild(thisTD);
				});
				if (!isFixed) {
					addTableButtons(thisTR);
				}
				return thisTR;
			}));
			thisTable.appendChild(thisTbody);
			thisOptionFormEle = thisTable;

			thisLabel.after(thisOptionDescription);
			if (!isFixed) {
				// Create an "add row" button...
				const addRowButton = document.createElement('button');
				addRowButton.className = 'addRowButton';
				addRowButton.textContent = i18n(option.addRowText || 'settingsConsoleDefaultAddRowText');
				addRowButton.setAttribute('type', 'button');
				addRowButton.setAttribute('optionName', optionKey);
				addRowButton.setAttribute('moduleID', mod.moduleID);
				addRowButton.addEventListener('click', (e: Event) => {
					const optionName = e.currentTarget.getAttribute('optionName');
					const thisTbodyName = `tbody_${optionName}`;
					const thisTbody = document.getElementById(thisTbodyName);
					const newRow = document.createElement('tr');
					const rowCount = (thisTbody.querySelectorAll('tr')) ? thisTbody.querySelectorAll('tr').length + 1 : 1;
					mod.options[optionName].fields.forEach(thisOpt => {
						const newCell = document.createElement('td');
						newCell.className = 'hasTableOption';

						const optionNameWithRow = `${optionName}_${thisOpt.name}_${rowCount}`;
						const thisInput = drawOptionInput(mod, optionNameWithRow, thisOpt, true);
						newCell.appendChild(thisInput);
						if (thisOpt.type === 'hidden') newCell.hidden = true;
						newRow.appendChild(newCell);
						const firstText = newRow.querySelector('input[type=text], textarea');
						if (firstText) setTimeout(() => firstText.focus());
					});

					addTableButtons(newRow);

					thisTbody.appendChild(newRow);
					thisTbody.dispatchEvent(new Event('change', { bubbles: true }));
				}, true);

				thisOptionSetting.after(addRowButton);

				Sortable.create(thisTbody, { handle: '.handle' });
			}
		} else if (option.type === 'builder') {
			thisOptionContainer.classList.add('specialOptionType');
			thisLabel.after(thisOptionDescription);
			thisOptionFormEle = caseBuilder.drawOptionBuilder(thisOptions, mod, optionKey);
		} else {
			if ((option.type === 'text') || (option.type === 'password') || (option.type === 'keycode')) {
				thisOptionDescription.classList.add('textInput');
			}
			thisOptionFormEle = drawOptionInput(mod, optionKey, option);
			thisOptionContainer.appendChild(thisOptionDescription);
		}
		thisOptionSetting.appendChild(thisOptionFormEle);
		attachOptionAdvice(thisOptionContainer, mod, optionKey, option);
		return thisOptionContainer;
	}).filter(Boolean));

	refreshOptionAdvice();

	const noOptions = RESConfigPanelOptions.querySelector('#noOptions');
	noOptions.style.display = 'none';
	// Detach any stale scrim from the previous module before we either skip
	// (no options) or create a fresh one. Without this, the previous call's
	// scrim jQuery wrapper points into a detached DOM subtree and subsequent
	// `.toggleClass` calls in `updateCurrentModuleState` silently mutate a
	// ghost.
	moduleOptionsScrimEl = undefined;
	if (optCount === 0) {
		const permissionsInfo = mod.moduleID === 'requestPermissions';
		const title = noOptions.querySelector('strong');
		const copy = noOptions.querySelector('span:last-child');
		if (title instanceof HTMLElement) title.textContent = i18n(permissionsInfo ? 'settingsConsolePermissionsControlTitle' : 'settingsConsoleNoConfigurableOptions');
		if (copy instanceof HTMLElement) copy.textContent = i18n(permissionsInfo ? 'settingsConsolePermissionsControlCopy' : 'settingsConsoleNoModuleOptions');
		noOptions.classList.toggle('is-permissions-info', permissionsInfo);
		noOptions.style.display = 'grid';
	} else {
		const scrimDiv = document.createElement('div');
		scrimDiv.id = 'moduleOptionsScrim';
		scrimDiv.setAttribute('role', 'status');
		scrimDiv.classList.remove('visible');
		const scrimIcon = document.createElement('span');
		scrimIcon.className = 'moduleOptionsScrimIcon';
		scrimIcon.setAttribute('aria-hidden', 'true');
		const scrimTitle = document.createElement('strong');
		scrimTitle.className = 'moduleOptionsScrimTitle';
		scrimTitle.textContent = i18n('settingsConsoleModuleDisabledTitle');
		const scrimText = document.createElement('span');
		scrimText.className = 'moduleOptionsScrimText';
		scrimText.textContent = i18n('settingsConsoleEnableModuleScrim');
		scrimDiv.append(scrimIcon, scrimTitle, scrimText);
		allOptionsContainer.appendChild(scrimDiv);
		moduleOptionsScrimEl = scrimDiv;
	}
	syncModuleOptionsInteractivity(true);

	function addTableButtons(thisTR) {
		// add delete button
		let thisTD = document.createElement('td');
		const thisDeleteButton = document.createElement('button');
		thisDeleteButton.className = 'res-icon-button res-icon deleteButton';
		thisDeleteButton.type = 'button';
		thisDeleteButton.textContent = '\uF056';
		thisDeleteButton.title = i18n('settingsConsoleRemoveRow');
		thisDeleteButton.setAttribute('aria-label', i18n('settingsConsoleRemoveRow'));

		thisDeleteButton.addEventListener('click', () => {
			const tbody = downcast(thisTR.closest('tbody'), HTMLTableSectionElement);
			thisTR.dispatchEvent(new Event('change', { bubbles: true }));
			thisTR.remove();
			CreateElement.undo(i18n('settingsConsoleRestoreDeletedRow')).then(() => { tbody.appendChild(thisTR); tbody.dispatchEvent(new Event('change', { bubbles: true })); });
		});
		thisTD.appendChild(thisDeleteButton);
		thisTR.appendChild(thisTD);

		// add move handle
		thisTD = document.createElement('td');
		const thisHandle = document.createElement('button');
		thisHandle.className = 'res-icon-button res-icon handle';
		thisHandle.type = 'button';
		thisHandle.textContent = '\uF0AA';
		thisHandle.title = i18n('settingsConsoleMoveRow');
		thisHandle.setAttribute('aria-label', i18n('settingsConsoleMoveRow'));

		thisTD.appendChild(thisHandle);
		thisTR.prepend(thisTD);
	}
}

const autostageDebounce = frameDebounce(stageCurrentModuleOptions);

function stageCurrentModuleOptions() {
	const panelOptionsDiv = RESConfigPanelOptions;
	// first, go through inputs that aren't of a specialized type like table or builder
	for (const e of panelOptionsDiv.querySelectorAll('.optionContainer:not(.specialOptionType) input, .optionContainer:not(.specialOptionType) select, .optionContainer:not(.specialOptionType) textarea')) {
		{
			const input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement = (e: any);
			// save values of any inputs onscreen, but skip ones with 'capturefor' - those are display only.
			if ((input.getAttribute('type') !== 'button') &&
					(input.getAttribute('displayonly') !== 'true') &&
					(input.getAttribute('tableOption') !== 'true')) {
				// The option key is stated on the element, not parsed out of its id.
				// Ids are namespaced by module — two modules sharing an option key
				// used to collide — and deriving application data from a DOM address
				// is what made namespacing them a breaking change to begin with.
				const optionName = input.dataset.optionKey ||
					(input.getAttribute('type') === 'radio' ? input.getAttribute('name') : input.getAttribute('id'));
				// get the module name out of the input's moduleid attribute
				let optionValue;
				if (/*:: input instanceof HTMLInputElement && */ input.getAttribute('type') === 'checkbox') {
					optionValue = !!input.checked;
				} else if (input.getAttribute('type') === 'radio') {
					if (input.checked) {
						optionValue = input.value;
					}
					// check if it's a keycode, in which case we need to parse it into an array...
				} else if (input.getAttribute('class') && input.getAttribute('class').includes('keycode')) {
					const tempArray = input.value.split(',');
					// convert the internal values of this array into their respective types (int, bool, bool, bool)
					optionValue = [parseInt(tempArray[0], 10), (tempArray[1] === 'true'), (tempArray[2] === 'true'), (tempArray[3] === 'true'), (tempArray[4] === 'true')];
				} else {
					optionValue = input.value;
				}
				if (typeof optionValue !== 'undefined') {
					Options.stage.add(currentModule.moduleID, optionName, optionValue);
				}
			}
		}
	}
	// Check if there are any tables of options on this panel...
	const optionsTables = panelOptionsDiv.querySelectorAll('.optionsTable');

	// For each table, we need to go through each row in the tbody, and then go through each option and make a multidimensional array.
	// For example, something like: [['foo','bar','baz'],['pants','warez','cats']]
	for (const table of optionsTables) {
		const moduleID = table.getAttribute('moduleID');
		const optionName = table.getAttribute('optionName');
		const thisTBODY = table.querySelector('tbody');
		const thisRows = thisTBODY.querySelectorAll('tr');
		// go through each row, and get all of the inputs...
		const optionMulti = Array.from(thisRows)
			.map(row => {
				const cells = row.querySelectorAll('td.hasTableOption');
				let notAllBlank = false;
				const optionRow = Array.from(cells).map(cell => {
					const inputs: NodeList<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = (cell.querySelectorAll('input[tableOption=true], select[tableOption=true], textarea[tableOption=true]'): any);
					let optionValue = null;
					for (const input of inputs) {
						if (/*:: input instanceof HTMLInputElement && */ input.getAttribute('type') === 'checkbox') {
							optionValue = input.checked;
						} else if (input.getAttribute('type') === 'radio') {
							if (input.checked) {
								optionValue = input.value;
							}
							// check if it's a keycode, in which case we need to parse it into an array...
						} else if (input.getAttribute('class') && input.getAttribute('class').includes('keycode')) {
							const tempArray = input.value.split(',');
							// convert the internal values of this array into their respective types (int, bool, bool, bool)
							optionValue = [parseInt(tempArray[0], 10), (tempArray[1] === 'true'), (tempArray[2] === 'true'), (tempArray[3] === 'true'), (tempArray[4] === 'true')];
						} else {
							optionValue = input.value;
						}
						if ((optionValue !== '') && (input.getAttribute('type') !== 'radio') &&
								// If no keyCode is set, then discard the value
								!(Array.isArray(optionValue) && isNaN(optionValue[0]))) {
							notAllBlank = true;
						}
					}
					return optionValue;
				});

				if (notAllBlank) {
					return optionRow;
				}
			})
			.filter(optionRow => Array.isArray(optionRow) && optionRow.length > 0);

		const mod = Modules.get(moduleID);

		if (typeof mod.options[optionName].sort === 'function') {
			optionMulti.sort(mod.options[optionName].sort);
		}

		Options.stage.add(moduleID, optionName, optionMulti);
	}

	for (const builder of panelOptionsDiv.querySelectorAll('.optionBuilder')) {
		const moduleId = builder.dataset.moduleId;
		const optionName = builder.dataset.optionName;

		const { customOptionsFields, cases } = Modules.get(moduleId).options[optionName];

		const items = [];
		for (const builderItem of builder.querySelectorAll('.builderItem')) {
			try {
				items.push(caseBuilder.readBuilderItem(builderItem, customOptionsFields, cases));
			} catch (e) {
				console.error('Ignoring invalid item.', e);
			}
		}
		Options.stage.add(moduleId, optionName, items);
	}

	updateSaveButton();
	updateDependsOn(currentModule);
}

function updateSaveButton() {
	const { optionCount, moduleCount, scopeCount } = Options.stage.getCounts();
	const changeCount = optionCount + moduleCount;
	const unsavedOptions = changeCount > 0;
	const defaultSaveLabel = i18n('settingsConsoleSaveDefault');

	clearTimeout(saveStatusTimer);

	RESConsoleContainer.classList.toggle('has-unsaved-options', unsavedOptions);
	if (saveButton) {
		saveButton.disabled = isSavingOptions || !unsavedOptions;
		saveButton.classList.toggle('optionsSaved', !unsavedOptions && !isSavingOptions);
		saveButton.textContent = isSavingOptions ? i18n('settingsConsoleSaving') : unsavedOptions ? pluralI18n(changeCount, 'settingsConsoleSaveStagedOne', 'settingsConsoleSaveStagedMany', changeCount) : defaultSaveLabel;
		const saveLabel = isSavingOptions ? i18n('settingsConsoleSaving') : unsavedOptions ? pluralI18n(changeCount, 'settingsConsoleSaveStagedAriaOne', 'settingsConsoleSaveStagedAriaMany', changeCount) : defaultSaveLabel;
		saveButton.setAttribute('aria-label', saveLabel);
		saveButton.setAttribute('title', saveLabel);
	}

	if (discardButton) {
		discardButton.hidden = !unsavedOptions;
		discardButton.disabled = isSavingOptions || !unsavedOptions;
	}

	if (globalStageBar) {
		const text = globalStageBar.querySelector('.globalStageText');
		if (text instanceof HTMLElement) text.textContent = isSavingOptions ? i18n('settingsConsoleSaving') : getWorkspaceStageSummary(changeCount, scopeCount);
		globalStageBar.classList.remove('is-saved-pulse');
		globalStageBar.classList.toggle('is-dirty', unsavedOptions && !isSavingOptions);
		globalStageBar.classList.toggle('is-saved', !unsavedOptions && !isSavingOptions);
		if (isSavingOptions) globalStageBar.setAttribute('aria-busy', 'true');
		else globalStageBar.removeAttribute('aria-busy');
	}

	updateModuleStageMarkers();
	updateFilterChipCounts();
}

function updateDependsOn(mod) {
	const stagedOptions = getOptions(mod);
	for (const [optionKey, { dependsOn }] of Object.entries(stagedOptions)) {
		if (dependsOn) {
			const optContainer = document.getElementById(`optionContainer-${mod.moduleID}-${optionKey}`);
			if (optContainer) optContainer.classList.toggle('dependsOnDisabledOptions', !dependsOn(stagedOptions));
		}
	}
}

// Escape inside a text field means "abandon what I am typing", not "throw away
// the whole console". The listener is on `document.body` with no target guard,
// so a user clearing the search box or a mistyped option value lost the entire
// workspace — including anything staged but unsaved — for the keystroke that
// normally undoes one field.
function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target instanceof HTMLTextAreaElement) return true;
	if (!(target instanceof HTMLInputElement)) return false;
	// Types where Escape has no native meaning — a checkbox or a colour swatch —
	// are not text entry and should still close the console.
	return ['text', 'search', 'password', 'url', 'email', 'number', 'tel'].includes(target.type);
}

function handleEscapeKey(event: KeyboardEvent) {
	if (event.key !== NAMED_KEYS.Escape) return;

	const target = event.target;
	if (isTextEntry(target)) {
		const field: any = target;
		// Clear if there is something to clear, otherwise step out of the field.
		// Either way the console stays open, and a second Escape closes it.
		if (field.isContentEditable) field.blur();
		else if (field.value) field.value = '';
		else field.blur();
		return;
	}

	close();
}

function getAbandonChangesConfirmation() {
	return i18n('settingsConsoleAbandonChangesConfirmation');
}

function handleBeforeUnload() {
	if (Options.stage.isDirty()) {
		return getAbandonChangesConfirmation();
	}
}

function notifyCloseBlockedByUnsavedChanges() {
	const message = i18n(isSavingOptions ? 'settingsConsoleSavingCloseBlocked' : 'settingsConsoleUnsavedCloseBlocked');
	clearTimeout(closeBlockedStatusTimer);

	if (globalStageBar) {
		const text = globalStageBar.querySelector('.globalStageText');
		if (text instanceof HTMLElement) text.textContent = message;
		globalStageBar.classList.add('is-attention');
	}

	settingsToast(message, 3600);

	if (!isSavingOptions && saveButton) {
		requestAnimationFrame(() => saveButton.focus());
	}

	closeBlockedStatusTimer = setTimeout(() => {
		if (globalStageBar) globalStageBar.classList.remove('is-attention');
		updateSaveButton();
	}, 3200);
}

function close({ promptIfStagedOptions = true }: {| promptIfStagedOptions?: boolean |} = {}) {
	if (promptIfStagedOptions) {
		if (currentModule) stageCurrentModuleOptions();
		if (Options.stage.isDirty() || isSavingOptions) {
			notifyCloseBlockedByUnsavedChanges();
			return;
		}
	}

	SettingsNavigation.close();
}

function setModuleFilter(filter: 'all' | 'enabled' | 'disabled' | 'modified') {
	if (currentFilter === filter) return;
	currentFilter = filter;
	const chips = RESConsoleContainer.querySelectorAll('#RESFilterChips .filterChip');
	for (const chip of chips) {
		const active = chip.getAttribute('data-filter') === filter;
		chip.classList.toggle('is-active', active);
		chip.setAttribute('aria-pressed', active ? 'true' : 'false');
	}
	applyModuleFilter();
}

function applyModuleFilter() {
	// Only the open category's rows are candidates — the tab strip is the
	// category filter, the chips filter within it.
	const rows = RESConsoleContainer.querySelectorAll('.RESConfigPanelCategory.active .moduleRow');
	let visibleRowCount = 0;
	for (const row of rows) {
		if (!(row instanceof HTMLElement)) continue;
		const moduleID = row.getAttribute('data-module-id') || '';
		const enabled = getModuleEnabled(moduleID);
		const modified = getModuleStageCount(moduleID) > 0;
		let show = true;
		switch (currentFilter) {
			case 'enabled': show = enabled; break;
			case 'disabled': show = !enabled; break;
			case 'modified': show = modified; break;
			case 'all': default: show = true;
		}
		row.classList.toggle('is-filtered-out', !show);
		if (show) visibleRowCount += 1;
	}
	// Empty state: if nothing matched, show a placeholder with a "reset" action
	// so users don't think the module list broke.
	const emptyState = RESConsoleContainer.querySelector('#RESConfigPanelModulesEmpty');
	const moduleList = RESConsoleContainer.querySelector('#RESConfigPanelModulesList');
	if (emptyState instanceof HTMLElement) {
		emptyState.hidden = visibleRowCount > 0;
	}
	if (moduleList instanceof HTMLElement) {
		moduleList.hidden = visibleRowCount === 0;
	}
	updateModuleLibrarySummary(visibleRowCount);
}

function modulesInActiveCategory() {
	return visibleModules().filter(mod => mod.category === activeCategory);
}

function updateFilterChipCounts() {
	const scoped = modulesInActiveCategory();
	let enabled = 0;
	let disabled = 0;
	let modified = 0;
	for (const m of scoped) {
		if (getModuleEnabled(m.moduleID)) enabled++;
		else disabled++;
		if (getModuleStageCount(m.moduleID) > 0) modified++;
	}
	const counts = { all: scoped.length, enabled, disabled, modified };
	for (const [key, value] of Object.entries(counts)) {
		const el = RESConsoleContainer.querySelector(`#RESFilterChips .filterChipCount[data-count="${key}"]`);
		if (el instanceof HTMLElement) el.textContent = String(value);
	}
	updateCategoryTabStageMarkers();
}

function getOptions(mod) {
	const staged = Options.stage.get(mod.moduleID);

	return mapValues(mod.options, (stored, key: string) => ({
		...stored,
		...staged && staged[key],
	}));
}

function notifyOptionsSaved() {
	if (!globalStageBar) return;
	const text = globalStageBar.querySelector('.globalStageText');
	if (text instanceof HTMLElement) text.textContent = i18n('settingsConsoleSavedJustNow');
	globalStageBar.classList.remove('is-dirty');
	globalStageBar.classList.add('is-saved', 'is-saved-pulse');
	clearTimeout(saveStatusTimer);
	saveStatusTimer = setTimeout(() => { updateSaveButton(); }, 1500);
}

// --- selector drift ---------------------------------------------------------
//
// A drift finding used to land as one entry in the module error log, which is a
// textarea of everything that has ever gone wrong, sorted by nothing the reader
// cares about. Old Reddit's markup is the ground this whole fork is built on and
// reddit has said it is weighing access limits and a rebuild, so "which surfaces
// are on a fallback, on which kind of page, and since when" deserves to be
// answerable at a glance.
//
// It stays silent when every selector matches. A diagnostics panel that is
// always on screen is furniture.

function driftDayLabel(timestamp) {
	try {
		return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	} catch (e) {
		return new Date(timestamp).toISOString().slice(0, 10);
	}
}

function renderDriftRecords(list, records) {
	list.replaceChildren(...records.map(record => {
		const group = document.createElement('section');
		group.className = 'selectorDriftGroup';
		group.dataset.pageType = record.pageType;

		const heading = document.createElement('h3');
		heading.className = 'selectorDriftGroupTitle';
		heading.textContent = record.pageType;

		const dates = document.createElement('p');
		dates.className = 'selectorDriftGroupDates';
		dates.textContent = record.firstSeen === record.lastSeen ?
			`Seen ${driftDayLabel(record.lastSeen)}` :
			`Since ${driftDayLabel(record.firstSeen)} — last seen ${driftDayLabel(record.lastSeen)}`;

		const items = document.createElement('ul');
		items.className = 'selectorDriftFindings';
		for (const finding of record.findings) {
			const item = document.createElement('li');
			item.className = 'selectorDriftFinding';
			item.dataset.status = finding.status;
			item.textContent = describeFinding(finding);
			items.append(item);
		}

		group.append(heading, dates, items);
		return group;
	}));
}

async function refreshSelectorDrift() {
	const panel = RESConsoleContainer && RESConsoleContainer.querySelector('#RESSelectorDrift');
	if (!(panel instanceof HTMLElement)) return;

	const state = await readSelectorDrift();
	const records = driftRecords(state);
	if (!records.length) {
		panel.hidden = true;
		return;
	}

	const title = panel.querySelector('#RESSelectorDriftTitle');
	const list = panel.querySelector('#RESSelectorDriftList');
	const status = panel.querySelector('#RESSelectorDriftStatus');
	if (!(list instanceof HTMLElement)) return;

	const surfaces = countDriftedSurfaces(state);
	if (title instanceof HTMLElement) {
		title.textContent = `Selector drift — ${surfaces} surface${surfaces === 1 ? '' : 's'} on ${records.length} page kind${records.length === 1 ? '' : 's'}`;
	}
	renderDriftRecords(list, records);
	if (status instanceof HTMLElement) status.textContent = '';
	panel.hidden = false;

	const copy = panel.querySelector('#RESSelectorDriftCopy');
	if (copy instanceof HTMLElement && !copy.dataset.wired) {
		copy.dataset.wired = 'true';
		copy.addEventListener('click', async () => {
			const report = formatDriftReport(await readSelectorDrift(), Metadata.version);
			try {
				await navigator.clipboard.writeText(report);
				if (status instanceof HTMLElement) status.textContent = 'Report copied to the clipboard.';
			} catch (e) {
				// A denied clipboard permission must not leave the user with nothing.
				// Selecting the text for them is the fallback every other copy button
				// in this codebase would want and none of them have.
				const area = document.createElement('textarea');
				area.className = 'selectorDriftFallbackReport';
				area.readOnly = true;
				area.rows = 8;
				area.value = report;
				list.after(area);
				area.select();
				if (status instanceof HTMLElement) status.textContent = 'Clipboard unavailable — the report is selected above, copy it by hand.';
			}
		});
	}

	const clear = panel.querySelector('#RESSelectorDriftClear');
	if (clear instanceof HTMLElement && !clear.dataset.wired) {
		clear.dataset.wired = 'true';
		clear.addEventListener('click', async () => {
			await clearSelectorDrift();
			panel.hidden = true;
			// Not a dismissal: the next page that drifts records it again. Saying so
			// avoids the reading where clearing means "stop checking".
			if (status instanceof HTMLElement) status.textContent = '';
		});
	}
}
