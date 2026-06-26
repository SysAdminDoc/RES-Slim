/* @flow */

import { mapValues, sortBy, groupBy, once } from '../utils/functional';
import { markdown } from 'snudown-js';
import { Sortable } from '../vendor';
import * as Metadata from '../core/metadata';
import * as Modules from '../core/modules';
import * as Options from '../core/options';
import {
	InvalidSnapshotError,
	applySnapshot,
	buildSnapshot,
	parseSnapshot,
	serializeSnapshot,
	suggestedFilename,
} from '../core/options/snapshot';
import {
	DEFAULT_SETTINGS_THEME,
	SETTINGS_THEME_PRESETS,
	getSettingsThemeMetaColor,
	normalizeSettingsTheme,
} from '../core/theme/settingsThemePresets';
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
} from '../utils';
import { context, i18n, Permissions } from '../environment';
import { showNotification } from '../modules/notifications';
import * as SettingsNavigation from '../modules/settingsNavigation';
import * as Search from '../modules/search';
import * as NightMode from '../modules/nightMode';
import { consoleContainerTemplate, moduleSelectorTemplate } from './templates';

const DEFAULT_MODULE = NightMode.module;
const CATEGORY_SORT = [
	'myAccountCategory',
	'usersCategory',
	'commentsCategory',
	'submissionsCategory',
	'subredditsCategory',
	'appearanceCategory',
	'browsingCategory',
	'productivityCategory',
	'coreCategory',
];

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
let moduleLibraryCategoryCount = 0;
let currentFilter: 'all' | 'enabled' | 'disabled' | 'modified' = 'all';
let isSavingOptions = false;

const MOBILE_SIDEBAR_BREAKPOINT = 960;
const SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme';
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
		const { moduleCount } = await applySnapshot(snapshot);
		showNotification({ moduleID: 'settingsBackup', message: i18n('settingsConsoleImportSuccess', moduleCount) }, 4000);
		// Reload so every module re-reads its options from storage with the imported values.
		setTimeout(() => { location.reload(); }, 600);
	} catch (e) {
		const reason = e instanceof InvalidSnapshotError ? e.message : (e instanceof Error ? e.message : String(e));
		showNotification({ moduleID: 'settingsBackup', message: i18n('settingsConsoleImportFailed', reason) }, 8000);
		throw e;
	}
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

	window.addEventListener('message', ({ data }) => {
		if (data.close) {
			close();
		} else if (data.load) {
			const { moduleID, optionKey } = data.load;
			load(moduleID, optionKey);
		}
	});

	loadFromHash();

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
		setSidebarCollapsed(Boolean(moduleID && moduleID !== Search.module.moduleID));
	}
}

function load(moduleID, optionKey) {
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
	moduleLibraryCategoryCount = new Set(Modules.all().filter(mod => !mod.hidden).map(mod => mod.category)).size;
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
			const modBtn = e.target instanceof Element && e.target.closest('.moduleButton');
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
						shortDescription: description.split(/[!?.]/)[0],
						isEnabled: Modules.isEnabled(mod),
						alwaysEnabled: !!mod.alwaysEnabled,
					};
				}),
		}));

	return moduleSelectorTemplate(sortBy(showCategories, ({ name }) => CATEGORY_SORT.indexOf(name)));
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

	openCategoryPanel(mod.category);
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

	if (moduleOptionsScrimEl) moduleOptionsScrimEl.classList.toggle('visible', !enabled);
	syncModuleOptionsInteractivity(enabled);
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

function updateModuleLibrarySummary(visibleRowCount?: number, visibleCategoryCount?: number) {
	const totalModuleCount = Modules.all().filter(mod => !mod.hidden).length;
	const shownModuleCount = typeof visibleRowCount === 'number' ? visibleRowCount : totalModuleCount;
	const shownCategoryCount = typeof visibleCategoryCount === 'number' ? visibleCategoryCount : moduleLibraryCategoryCount;
	const stagedModuleCount = Array.from(RESConsoleContainer.querySelectorAll('.moduleButton.has-staged-changes')).length;
	const moduleCountBadge = RESConsoleContainer.querySelector('#RESModuleCountBadge');
	const moduleLibraryMeta = RESConsoleContainer.querySelector('#RESModuleLibraryMeta');
	const countSummary = currentFilter === 'all' ?
		pluralI18n(shownCategoryCount, 'settingsConsoleCategorySummaryOne', 'settingsConsoleCategorySummaryMany', shownCategoryCount) :
		pluralI18n(shownModuleCount, FILTER_SUMMARY_KEYS[currentFilter][0], FILTER_SUMMARY_KEYS[currentFilter][1], shownModuleCount);
	const categorySummary = currentFilter === 'all' ? '' :
		pluralI18n(shownCategoryCount, 'settingsConsoleInCategoryOne', 'settingsConsoleInCategoryMany', shownCategoryCount);
	const stagedSummary = stagedModuleCount ? ` • ${pluralI18n(stagedModuleCount, 'settingsConsoleStagedModulesOne', 'settingsConsoleStagedModulesMany', stagedModuleCount)}` : '';

	if (moduleCountBadge instanceof HTMLElement) {
		moduleCountBadge.textContent = `${shownModuleCount}`;
		moduleCountBadge.setAttribute('aria-label', pluralI18n(shownModuleCount, 'settingsConsoleModuleCountLabelOne', 'settingsConsoleModuleCountLabelMany', shownModuleCount));
	}

	if (moduleLibraryMeta instanceof HTMLElement) {
		moduleLibraryMeta.textContent = `${countSummary}${categorySummary}${stagedSummary}`;
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

function drawOptionInput(mod, optionName, optionObject, isTable) {
	let thisOptionFormEle;
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
			thisOptionFormEle = _ce('textarea', { id: optionName, type: 'textarea', moduleID: mod.moduleID });
			thisOptionFormEle.innerHTML = escapeHTML(optionObject.value);
			break;
		case 'list':
		case 'text':
		case 'hidden':
			thisOptionFormEle = _ce('input', { id: optionName, type: optionObject.type === 'hidden' ? 'hidden' : 'text', moduleID: mod.moduleID });
			if (typeof optionObject.value !== 'undefined') thisOptionFormEle.setAttribute('value', optionObject.value);
			break;
		case 'color':
			thisOptionFormEle = _ce('input', { id: optionName, type: 'color', moduleID: mod.moduleID });
			if (typeof optionObject.value !== 'undefined') ((thisOptionFormEle: any): HTMLInputElement).value = optionObject.value;
			break;
		case 'button': {
			const { values = [], callback, text } = optionObject;
			if (callback && text) values.push({ callback, text });
			const buttonsContainer = thisOptionFormEle = _ce('div', { id: optionName });
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
			thisOptionFormEle = _ce('input', { id: optionName, type: 'password', moduleID: mod.moduleID });
			if (typeof optionObject.value !== 'undefined') thisOptionFormEle.setAttribute('value', optionObject.value);
			break;
		case 'boolean': {
			const toggleEl = CreateElement.toggleButton(
				() => { RESConsoleContainer.dispatchEvent(new Event('change', { bubbles: true })); },
				optionName, optionObject.value, undefined, undefined, isTable,
			);
			thisOptionFormEle = toggleEl;
			thisOptionFormEle.setAttribute(
				isTable ? 'aria-label' : 'aria-labelledby',
				isTable ? i18n(optionObject.name || optionName) : `${mod.moduleID}-${optionName}-label`,
			);
			break;
		}
		case 'enum':
			thisOptionFormEle = _ce('div', { id: optionName, class: 'enum' });
			if (optionObject.value && !optionObject.values.some(({ value }) => value === optionObject.value)) {
				optionObject.values.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
			}
			optionObject.values.forEach((optionValue, index) => {
				const thisId = `${optionName}-${index}`;
				const radio = _ce('input', { id: thisId, type: 'radio', name: optionName, moduleID: mod.moduleID, value: optionValue.value });
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
			const realInput = _ce('input', { id: optionName, type: 'text', class: 'keycode', moduleID: mod.moduleID });
			realInput.style.border = '1px solid red';
			realInput.style.display = 'none';
			(realInput: any).value = optionObject.value;
			if (isTable) realInput.setAttribute('tableOption', 'true');
			const displayInput = _ce('input', { id: `${optionName}-display`, type: 'text', capturefor: optionName, displayonly: 'true' });
			(displayInput: any).value = niceKeyCode(optionObject.value);
			thisOptionFormEle = _ce('div');
			thisOptionFormEle.append(realInput, displayInput);
			break;
		}
		case 'select':
			thisOptionFormEle = _ce('select', { id: optionName, class: 'select' });
			if (optionObject.value && !optionObject.values.some(({ value }) => value === optionObject.value)) {
				optionObject.values.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
			}
			optionObject.values.forEach((optionValue, index) => {
				const thisId = `${optionName}-${index}`;
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
	const moduleOptionSummary = RESConsoleContainer.querySelector('#moduleOptionSummary');
	moduleOptionSummary.textContent = isSearchWorkspace ?
		i18n('settingsConsoleWorkspaceSummary') :
		getModuleOptionSummary(mod, configurableOptions.length, advancedOptionCount);

	updateCurrentModuleState(mod);

	updateSaveButton();

	const thisDescription = RESConsoleContainer.querySelector('.moduleDescription');
	thisDescription.innerHTML = isSearchWorkspace ? Search.descriptionMarkup() : mod.descriptionRaw ? mod.description : markdown(i18n(mod.description));

	const allOptionsContainer = RESConsoleContainer.querySelector('#allOptionsContainer');
	while (allOptionsContainer.firstChild) allOptionsContainer.removeChild(allOptionsContainer.firstChild);
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
		thisLabel.id = `${mod.moduleID}-${optionKey}-label`;
		thisLabel.className = 'optionTitle';
		thisLabel.setAttribute('for', optionKey);
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
			$thisOptionContainer.addClass('table');
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
		return thisOptionContainer;
	}).filter(Boolean));

	RESConfigPanelOptions.querySelector('#noOptions').style.display = 'none';
	// Detach any stale scrim from the previous module before we either skip
	// (no options) or create a fresh one. Without this, the previous call's
	// scrim jQuery wrapper points into a detached DOM subtree and subsequent
	// `.toggleClass` calls in `updateCurrentModuleState` silently mutate a
	// ghost.
	moduleOptionsScrimEl = undefined;
	if (!optCount && mod.alwaysEnabled) {
		// do nothing
	} else if (optCount === 0) {
		RESConfigPanelOptions.querySelector('#noOptions').style.display = 'block';
	} else {
		const scrimDiv = document.createElement('div');
		scrimDiv.id = 'moduleOptionsScrim';
		scrimDiv.setAttribute('role', 'status');
		scrimDiv.classList.toggle('visible', !getModuleEnabled(mod.moduleID));
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
	syncModuleOptionsInteractivity(getModuleEnabled(mod.moduleID));

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
				// get the option name out of the input field id - unless it's a radio button...
				let optionName;
				if (input.getAttribute('type') === 'radio') {
					optionName = input.getAttribute('name');
				} else {
					optionName = input.getAttribute('id');
				}
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

function handleEscapeKey(event: KeyboardEvent) {
	if (event.key === NAMED_KEYS.Escape) {
		close();
	}
}

function getAbandonChangesConfirmation() {
	return i18n('settingsConsoleAbandonChangesConfirmation');
}

function handleBeforeUnload() {
	if (Options.stage.isDirty()) {
		return getAbandonChangesConfirmation();
	}
}

async function close({ promptIfStagedOptions = true }: {| promptIfStagedOptions?: boolean |} = {}) {
	if (promptIfStagedOptions && Options.stage.isDirty()) {
		await Alert.open(getAbandonChangesConfirmation(), { cancelable: true });
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
	const rows = RESConsoleContainer.querySelectorAll('.moduleRow');
	let visibleRowCount = 0;
	let visibleCategoryCount = 0;
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
	// Hide categories whose children are all filtered out so the list doesn't
	// show empty accordion headers.
	const categories = RESConsoleContainer.querySelectorAll('.RESConfigPanelCategory');
	for (const cat of categories) {
		if (!(cat instanceof HTMLElement)) continue;
		const visibleKids = cat.querySelectorAll('.moduleRow:not(.is-filtered-out)');
		const hasVisibleKids = visibleKids.length > 0;
		cat.classList.toggle('is-filtered-out', !hasVisibleKids);
		if (hasVisibleKids) visibleCategoryCount += 1;
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
	updateModuleLibrarySummary(visibleRowCount, visibleCategoryCount);
}

function updateFilterChipCounts() {
	const all = Modules.all().filter(m => !m.hidden);
	let enabled = 0;
	let disabled = 0;
	let modified = 0;
	for (const m of all) {
		if (getModuleEnabled(m.moduleID)) enabled++;
		else disabled++;
		if (getModuleStageCount(m.moduleID) > 0) modified++;
	}
	const counts = { all: all.length, enabled, disabled, modified };
	for (const [key, value] of Object.entries(counts)) {
		const el = RESConsoleContainer.querySelector(`#RESFilterChips .filterChipCount[data-count="${key}"]`);
		if (el instanceof HTMLElement) el.textContent = String(value);
	}
}

function openCategoryPanel(category) {
	const items = RESConsoleContainer.querySelectorAll('#RESConfigPanelModulesList .RESConfigPanelCategory');
	for (const item of items) {
		if (item.getAttribute('data-category') === category) {
			item.classList.add('active');
		} else {
			item.classList.remove('active');
		}
	}
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
