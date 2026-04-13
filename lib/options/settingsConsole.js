/* @flow */

import $ from 'jquery';
import { mapValues, sortBy, groupBy, once } from 'lodash-es';
import { markdown } from 'snudown-js';
import { Sortable } from '../vendor';
import * as Metadata from '../core/metadata';
import * as Modules from '../core/modules';
import * as Options from '../core/options';
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

let $moduleOptionsScrim;
let RESConfigPanelOptions;
let RESConsoleContainer;
let RESConsoleContent;
let currentModule;
let lastNonSearchModule = DEFAULT_MODULE;
let moduleToggle;
let saveButton;
let discardButton;
let globalStageBar;
let saveStatusTimer;
let moduleLibraryCategoryCount = 0;
let currentFilter: 'all' | 'enabled' | 'disabled' | 'modified' = 'all';

function getModuleEnabled(moduleID: string): boolean {
	const stagedEnabled = Options.stage.getModule(moduleID);
	return typeof stagedEnabled === 'boolean' ? stagedEnabled : Modules.isEnabled(moduleID);
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
		requestAnimationFrame(() => { RESConsoleContent.scrollTop = 0; });
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
			showNotification('You opened a link to an advanced option, but not all options are shown. These options will be shown until you leave or refresh the page. If you want to see all options in the future, check the <i>Show advanced options</i> checkbox in the menu.', Infinity);
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

	requestAnimationFrame(() => document.querySelector('.res-logo').focus());

	const RESClose = RESConsoleContainer.querySelector('#RESClose');
	RESClose.addEventListener('click', (e: Event) => {
		e.preventDefault();
		close();
	}, true);

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
	const visibleModuleCount = Modules.all().filter(mod => !mod.hidden).length;
	const moduleCountBadge = RESConsoleContainer.querySelector('#RESModuleCountBadge');
	moduleCountBadge.textContent = `${visibleModuleCount}`;
	moduleCountBadge.setAttribute('aria-label', `${visibleModuleCount} modules`);
	moduleLibraryCategoryCount = new Set(Modules.all().filter(mod => !mod.hidden).map(mod => mod.category)).size;
	updateModuleStageMarkers();
	updateFilterChipCounts();

	$(RESConsoleContainer).find('#RESConfigPanelModulesPane')
		.on('click', '.moduleRowToggle', async function(e: Event) {
			// Inline sidebar toggle — flip the module enabled state in place
			// without navigating to its workspace. This lets users sweep through
			// the list flipping things on and off without the two-click dance.
			e.preventDefault();
			e.stopPropagation();
			const moduleID = $(this).attr('data-module-toggle');
			if (!moduleID) return;
			await toggleModuleEnabled(moduleID);
		})
		.on('click', '.moduleButton', function(e: Event) {
			const id = $(this).data('module');
			if (id) {
				e.preventDefault();
				load(id);
			}
		})
		.on('click', '.categoryButton', function(e: Event) {
			// Categories stay expanded by default. Clicking the header just
			// toggles its own collapsed state — it never collapses siblings.
			e.preventDefault();
			const $category = $(this).closest('.RESConfigPanelCategory');
			const expanded = $category.hasClass('is-expanded');
			$category.toggleClass('is-expanded', !expanded);
			$(this).attr('aria-expanded', String(!expanded));
			// If the user manually collapsed the currently-highlighted category,
			// drop the `.active` highlight — keeping it there reads as "this
			// category is still the selected scope" when visually the content is
			// hidden.
			if (expanded) $category.removeClass('active');
		});

	// Global filter chips — live-filter the module list by state.
	$(RESConsoleContainer).find('#RESFilterChips')
		.on('click', '.filterChip', function(e: Event) {
			e.preventDefault();
			const filter = $(this).attr('data-filter');
			if (filter === 'all' || filter === 'enabled' || filter === 'disabled' || filter === 'modified') {
				setModuleFilter(filter);
			}
		});

	// Empty-state "Show all modules" reset button inside the sidebar.
	$(RESConsoleContainer).find('#RESConfigPanelModulesEmpty')
		.on('click', '.sidebarEmptyStateReset', (e: Event) => {
			e.preventDefault();
			setModuleFilter('all');
		});

	RESConsoleContent = RESConsoleContainer.querySelector('#RESConsoleContent');

	RESConfigPanelOptions = RESConsoleContainer.querySelector('#RESConfigPanelOptions');

	$(RESConsoleContainer).find('#SearchRES-input-container').append(Search.input());
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

	// Okay, the console is done. Add it to the document body.
	document.body.append(RESConsoleContainer);
}

const createKeyCodeModal = once(() => {
	const $keyCodeModal = $('<div>', {
		id: 'keyCodeModal',
		text: 'Press a key (or combination with shift, alt and/or ctrl) to assign this action.',
	}).appendTo(document.body);
	let captureKey, captureKeyID;

	window.addEventListener('keydown', e => {
		if (captureKey && ![NAMED_KEYS.Shift, NAMED_KEYS.Control, NAMED_KEYS.Alt].includes(e.key)) {
			// capture the key, display something nice for it, and then close the popup...
			e.preventDefault();
			let keyArray;
			if (e.key === NAMED_KEYS.Backspace) { // we disable the shortcut
				keyArray = [-1, false, false, false, false];
			} else {
				keyArray = [e.keyCode, e.altKey, e.ctrlKey, e.shiftKey, e.metaKey];
			}
			// not using .getElementById here due to a collision with reddit's elements (i.e. #modmail)
			((RESConfigPanelOptions.querySelector(`[id="${captureKeyID}"]`): any): HTMLInputElement).value = keyArray.join(',');
			((RESConfigPanelOptions.querySelector(`[id="${captureKeyID}-display"]`): any): HTMLInputElement).value = niceKeyCode(keyArray);
			$keyCodeModal.css('display', 'none');
			captureKey = false;
		}
	});

	$(RESConsoleContent).on({
		focus(e) {
			// show dialog box to grab keycode, but display something nice...
			const $target = $(e.target);
			const { top, left } = $target.offset();
			$keyCodeModal.css({
				display: 'block',
				top: top + $target.height(),
				left,
			});
			captureKey = true;
			captureKeyID = $target.attr('capturefor');
		},
		blur() {
			// Must reset captureKey here, otherwise closing the settings console
			// while a keycode field still has focus leaves the window-level keydown
			// listener armed and it will eat innocent keystrokes on the main page.
			// (captureKeyID is intentionally left as-is; the captureKey=false guard
			// above makes it unreachable.)
			captureKey = false;
			$keyCodeModal.css('display', 'none');
		},
	}, '.keycode + input[type=text][displayonly]');

	return $keyCodeModal;
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
					const description = $(`<p>${mod.descriptionRaw ? mod.description : markdown(i18n(mod.description))}</p>`).text().replace(/\s+/g, ' ');

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
	const items = $(RESConsoleContainer).find('.moduleButton');

	const selected = items.filter(function() {
		return $(this).data('module') === mod.moduleID;
	});

	items.not(selected).removeClass('active').removeAttr('aria-current');
	selected.addClass('active').attr('aria-current', 'page');
	const selectedElement = selected.get(0);
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
		const stateText = mod.alwaysEnabled ? 'Always On' : enabled ? 'Enabled' : 'Disabled';
		stateBadge.textContent = stateText;
		stateBadge.classList.toggle('is-enabled', enabled && !isSearchWorkspace);
		stateBadge.classList.toggle('is-disabled', !enabled && !mod.alwaysEnabled && !isSearchWorkspace);
		stateBadge.classList.toggle('is-locked', mod.alwaysEnabled && !isSearchWorkspace);
	}

	$(moduleToggle)
		.toggle(!mod.alwaysEnabled)
		.toggleClass('enabled', enabled)
		.data('module', mod.moduleID)
		.attr('aria-label', `${enabled ? 'Disable' : 'Enable'} ${i18n(mod.moduleName)}`)
		.attr('aria-pressed', enabled ? 'true' : 'false')
		.attr('title', `${enabled ? 'Disable' : 'Enable'} ${i18n(mod.moduleName)}`);

	if ($moduleOptionsScrim) $moduleOptionsScrim.toggleClass('visible', !enabled);
}

function getModuleStageCount(moduleID) {
	const stagedOptions = Options.stage.get(moduleID);
	const optionCount = stagedOptions ? Object.keys(stagedOptions).length : 0;
	const moduleCount = typeof Options.stage.getModule(moduleID) === 'boolean' ? 1 : 0;
	return optionCount + moduleCount;
}

function updateModuleStageMarkers() {
	let stagedModuleCount = 0;

	$(RESConsoleContainer).find('.moduleButton').each(function() {
		const moduleID = String($(this).data('module'));
		const stagedCount = getModuleStageCount(moduleID);
		const hasStagedChanges = stagedCount > 0;
		const stageBadge = this.querySelector('.moduleButtonStage');
		this.classList.toggle('has-staged-changes', hasStagedChanges);

		if (stageBadge instanceof HTMLElement) {
			stageBadge.hidden = !hasStagedChanges;
			stageBadge.textContent = stagedCount === 1 ? '1 staged' : `${stagedCount} staged`;
		}

		if (hasStagedChanges) stagedModuleCount += 1;
	});

	const moduleLibraryMeta = RESConsoleContainer.querySelector('#RESModuleLibraryMeta');
	if (moduleLibraryMeta) {
		moduleLibraryMeta.textContent = stagedModuleCount ?
			`${moduleLibraryCategoryCount} categor${moduleLibraryCategoryCount === 1 ? 'y' : 'ies'} • ${stagedModuleCount} staged` :
			`${moduleLibraryCategoryCount} categor${moduleLibraryCategoryCount === 1 ? 'y' : 'ies'}`;
	}
}

function getModuleOptionSummary(mod, optionCount, advancedCount) {
	if (!optionCount) {
		return mod.alwaysEnabled ? 'Always on • No configurable settings' : 'No configurable settings';
	}

	const optionSummary = `${optionCount} setting${optionCount === 1 ? '' : 's'}`;
	const advancedSummary = advancedCount ? ` • ${advancedCount} advanced` : '';
	const stateSummary = mod.alwaysEnabled ? ' • Always on' : '';
	return `${optionSummary}${advancedSummary}${stateSummary}`;
}

function getWorkspaceStageSummary(changeCount, scopeCount) {
	if (!changeCount) {
		return 'All changes saved';
	}

	const scopeSummary = scopeCount > 1 ? ` across ${scopeCount} modules` : '';
	return `${changeCount} change${changeCount === 1 ? '' : 's'} staged${scopeSummary}`;
}

function drawOptionInput(mod, optionName, optionObject, isTable) {
	let $thisOptionFormEle;
	switch (optionObject.type) {
		case 'textarea':
			// textarea...
			$thisOptionFormEle = $('<textarea>', {
				id: optionName,
				type: 'textarea',
				moduleID: mod.moduleID,
				// this is typed user input and therefore safe, we allow HTML for a few settings.
				html: escapeHTML(optionObject.value),
			});
			break;
		case 'list':
		case 'text':
		case 'hidden':
			// text...
			$thisOptionFormEle = $('<input>', {
				id: optionName,
				type: optionObject.type === 'hidden' ? 'hidden' : 'text',
				moduleID: mod.moduleID,
			});
			if (typeof optionObject.value !== 'undefined') {
				$thisOptionFormEle.attr('value', optionObject.value);
			}
			break;
		case 'color':
			// color...
			$thisOptionFormEle = $('<input>', {
				id: optionName,
				type: 'color',
				moduleID: mod.moduleID,
			});
			// thisOptionFormEle.setAttribute('value', optionObject.value); // didn't work on chrome, need to work with .value
			if (typeof optionObject.value !== 'undefined') {
				(($thisOptionFormEle.get(0): any): HTMLInputElement).value = optionObject.value;
			}
			break;
		case 'button':
			// button...
			const { values = [], callback, text } = optionObject;
			if (callback && text) values.push({ callback, text });
			const buttonsContainer = $thisOptionFormEle = $('<div>', { id: optionName });
			for (const option of values) {
				let $thisOptionFormEle;
				if (typeof option.callback === 'string' || option.callback.moduleID) {
					$thisOptionFormEle = $('<a>');
				} else { // if (typeof optionObject.callback === 'function') {
					$thisOptionFormEle = $('<button>');
				}
				$thisOptionFormEle.addClass('RESConsoleButton');
				$thisOptionFormEle.attr('moduleID', mod.moduleID);
				if (option.text.tagName || option.text.jquery) {
					$thisOptionFormEle.append(option.text);
				} else if (typeof option.text === 'string') {
					$thisOptionFormEle.text(i18n(option.text));
				} else {
					$thisOptionFormEle.append(CreateElement.icon(0xF141));
				}
				if (option.callback.moduleID) {
					$thisOptionFormEle.attr('href', SettingsNavigation.makeUrlHash(option.callback.moduleID, option.callback.optionKey));
				} else if (typeof option.callback === 'string') {
					$thisOptionFormEle.attr('href', option.callback);
					$thisOptionFormEle.attr('target', '_blank');
					$thisOptionFormEle.attr('rel', 'noopener noreferrer');
				} else if (typeof option.callback === 'function') {
					$thisOptionFormEle.click(async function() {
						if (this.classList.contains('csspinner')) return;
						this.classList.add('csspinner');
						try {
							await option.callback(optionName, optionObject);
						} catch (e) {
							if (e.message) Alert.open(e.message);
							console.error(e);
						}
						this.classList.remove('csspinner');
					});
				}
				buttonsContainer.append($thisOptionFormEle);
			}
			break;
		case 'password':
			// password...
			$thisOptionFormEle = $('<input>', {
				id: optionName,
				type: 'password',
				moduleID: mod.moduleID,
			});
			if (typeof optionObject.value !== 'undefined') {
				$thisOptionFormEle.attr('value', optionObject.value);
			}
			break;
		case 'boolean':
			// checkbox
			$thisOptionFormEle = $(CreateElement.toggleButton(
				() => { $(RESConsoleContainer).trigger('change'); },
				optionName,
				optionObject.value,
				undefined,
				undefined,
				isTable,
			));
			$thisOptionFormEle.attr(
				isTable ? 'aria-label' : 'aria-labelledby',
				isTable ? i18n(optionObject.name || optionName) : `${mod.moduleID}-${optionName}-label`,
			);
			break;
		case 'enum':
			// radio buttons
			$thisOptionFormEle = $('<div>', {
				id: optionName,
				class: 'enum',
			});

			// Include existing value as option in case it is temporarily unavailable
			if (optionObject.value && !optionObject.values.some(({ value }) => value === optionObject.value)) {
				optionObject.values.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
			}

			optionObject.values.forEach((optionValue, index) => {
				const thisId = `${optionName}-${index}`;
				const $thisOptionFormSubEle = $('<input>', {
					id: thisId,
					type: 'radio',
					name: optionName,
					moduleID: mod.moduleID,
					value: optionValue.value,
				});
				if (isTable) $thisOptionFormSubEle.attr('tableOption', 'true');
				const nullEqualsEmpty = ((optionObject.value === null) && (optionValue.value === ''));
				// we also need to check for null == '' - which are technically equal.
				if ((optionObject.value === optionValue.value) || nullEqualsEmpty) {
					$thisOptionFormSubEle.attr('checked', 'checked');
				}
				const thisLabel = document.createElement('label');
				thisLabel.setAttribute('for', thisId);
				thisLabel.textContent = ` ${i18n(optionValue.name)} `;
				$thisOptionFormEle.append($thisOptionFormSubEle);
				$thisOptionFormEle.append(thisLabel);
				$thisOptionFormEle.append('<br>');
			});
			break;
		case 'keycode':
			createKeyCodeModal();
			// keycode - shows a key value, but stores a keycode and possibly shift/alt/ctrl combo.
			const realOptionFormEle = $('<input>').attr({
				id: optionName,
				type: 'text',
				class: 'keycode',
				moduleID: mod.moduleID,
			}).css({
				border: '1px solid red',
				display: 'none',
			}).val(optionObject.value);
			if (isTable) realOptionFormEle.attr('tableOption', 'true');

			const thisKeyCodeDisplay = $('<input>').attr({
				id: `${optionName}-display`,
				type: 'text',
				capturefor: optionName,
				displayonly: 'true',
			}).val(niceKeyCode(optionObject.value));
			$thisOptionFormEle = $('<div>').append(realOptionFormEle).append(thisKeyCodeDisplay);
			break;
		case 'select':
			$thisOptionFormEle = $('<select>').attr({
				id: optionName,
				class: 'select',
				value: optionObject.value,
			});

			// Include existing value as option in case it is temporarily unavailable
			if (optionObject.value && !optionObject.values.some(({ value }) => value === optionObject.value)) {
				optionObject.values.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
			}

			optionObject.values.forEach((optionValue, index) => {
				const thisId = `${optionName}-${index}`;
				const $thisOptionFormSubEle = $('<option />', {
					id: thisId,
					class: 'select-option',
					value: optionValue.value,
					moduleID: mod.moduleID,
					style: optionValue.style,
				}).text(optionValue.name);
				const nullEqualsEmpty = ((optionObject.value === null) && (optionValue.value === ''));
				// we also need to check for null == '' - which are technically equal.
				if ((optionObject.value === optionValue.value) || nullEqualsEmpty) {
					$thisOptionFormSubEle.attr('selected', 'selected');
				}
				$thisOptionFormEle.append($thisOptionFormSubEle);
			});
			break;
		default:
			throw new Error(`modules.${mod.moduleID}.options.${optionName} has invalid type: ${optionObject.type}`);
	}
	if (isTable) {
		$thisOptionFormEle.attr('tableOption', 'true');
	}
	return $thisOptionFormEle.get(0);
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
					header: 'Permission required',
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
		const label = rowToggle.getAttribute('aria-label');
		if (label) {
			const newLabel = enabled ? label.replace(/^Enable /, 'Disable ') : label.replace(/^Disable /, 'Enable ');
			rowToggle.setAttribute('aria-label', newLabel);
			rowToggle.setAttribute('title', newLabel);
		}
	}
}

function drawSettingsConsole() {
	// Per-module toggle mirror in the workspace header — kept for discoverability
	// while viewing a module's options. Delegates to the shared toggleModuleEnabled.
	const thisToggle = RESConsoleContainer.querySelector('.moduleToggle');
	moduleToggle = thisToggle;

	thisToggle.addEventListener('click', async function() {
		const moduleID = $(this).data('module');
		if (moduleID) await toggleModuleEnabled(moduleID);
	}, true);

	// Global save button in the top bar — applies every staged change at once.
	saveButton = ((RESConsoleContainer.querySelector('#RESGlobalSave'): any): HTMLButtonElement);
	saveButton.addEventListener('click', (e: Event) => {
		e.preventDefault();
		saveAllStagedOptions();
	}, true);

	// Global discard button — drops every staged change and refreshes the workspace.
	discardButton = ((RESConsoleContainer.querySelector('#RESGlobalDiscard'): any): HTMLButtonElement);
	discardButton.addEventListener('click', (e: Event) => {
		e.preventDefault();
		discardAllStagedOptions();
	}, true);

	globalStageBar = RESConsoleContainer.querySelector('#RESGlobalStageBar');

	$(document.body).on('keyup', handleEscapeKey);
	$(window).on('beforeunload', handleBeforeUnload);
	$(RESConsoleContainer)
		.on('input change', autostageDebounce);
}

function saveAllStagedOptions() {
	// The workspace autostages on input, so current-module edits are already
	// in the stage by the time Save is clicked. Just commit.
	if (currentModule) stageCurrentModuleOptions();
	try {
		Options.stage.commit();
	} catch (e) {
		console.error('RES-Slim: saving options failed', e);
		updateSaveButton();
		showNotification({
			moduleID: 'settingsNavigation',
			notificationID: 'optionsSaveFailed',
			message: `Saving options failed: ${String((e && e.message) || e)}`,
			closeDelay: 10000,
		}, 10000);
		return;
	}
	// Re-sync sidebar toggle state with the committed reality — modules that
	// were staged may have resolved differently.
	for (const mod of Modules.all().filter(m => !m.hidden)) {
		syncSidebarModuleState(mod.moduleID, Modules.isEnabled(mod));
	}
	updateSaveButton();
	updateFilterChipCounts();
	applyModuleFilter();
	notifyOptionsSaved();
}

function discardAllStagedOptions() {
	Options.stage.reset();
	// Redraw the current module so any form inputs revert to their saved values.
	if (currentModule) drawConfigOptions(currentModule);
	for (const mod of Modules.all().filter(m => !m.hidden)) {
		syncSidebarModuleState(mod.moduleID, Modules.isEnabled(mod));
	}
	updateSaveButton();
	updateFilterChipCounts();
	applyModuleFilter();
}

function drawConfigOptions(mod) {
	if (mod.hidden) return;

	const isSearchWorkspace = mod === Search.module;
	const thisOptions = getOptions(mod);
	const configurableOptions = Object.entries(thisOptions).filter(([, option]) => !option.noconfig);
	const advancedOptionCount = configurableOptions.filter(([, option]) => option.advanced).length;
	let optCount = 0;
	RESConfigPanelOptions.dataset.module = mod.moduleID;
	RESConsoleContainer.classList.toggle('is-search-workspace', isSearchWorkspace);

	const thisModuleName = RESConsoleContainer.querySelector('.moduleName');
	$(thisModuleName).html(isSearchWorkspace ?
		'Search Settings' :
		`${i18n(mod.moduleName)} <span class="moduleKey" translate="no">${mod.moduleID}</span>`);
	const thisModuleCategory = RESConsoleContainer.querySelector('.moduleCategoryBadge');
	thisModuleCategory.textContent = isSearchWorkspace ? 'Workspace' : i18n(mod.category);
	const moduleOptionSummary = RESConsoleContainer.querySelector('#moduleOptionSummary');
	moduleOptionSummary.textContent = isSearchWorkspace ?
		'Search modules, settings, and descriptions from one place.' :
		getModuleOptionSummary(mod, configurableOptions.length, advancedOptionCount);

	updateCurrentModuleState(mod);

	updateSaveButton();

	const thisDescription = RESConsoleContainer.querySelector('.moduleDescription');
	$(thisDescription).html(mod.descriptionRaw ? mod.description : markdown(i18n(mod.description)));

	const allOptionsContainer = RESConsoleContainer.querySelector('#allOptionsContainer');
	$(allOptionsContainer).empty();
	// now draw all the options...
	allOptionsContainer.append(...Object.entries(thisOptions).map(([optionKey, option]) => {
		if (option.noconfig) return;

		let thisOptionFormEle;
		optCount++;
		const containerID = `optionContainer-${mod.moduleID}-${optionKey}`;
		const $thisOptionContainer = $('<div>', { id: containerID, class: 'optionContainer' });

		if (option.dependsOn && !option.dependsOn(thisOptions)) {
			$thisOptionContainer.addClass('dependsOnDisabledOptions');
		}

		if (option.advanced) {
			$thisOptionContainer.addClass('advanced');
		}

		const optionTitle = i18n(option.title);

		const $thisLabel = $('<label>', {
			id: `${mod.moduleID}-${optionKey}-label`,
			class: 'optionTitle',
			for: optionKey,
			html: `${optionTitle}<br /><span class="optionKey">${optionKey}</span>`,
		});

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
			$thisLabel.attr('title', `Default: ${niceDefaultOption}`);
		}
		const $thisOptionDescription = $('<div>', {
			class: 'optionDescription',
			html: markdown(i18n(option.description)),
		});
		const $thisOptionSetting = $('<div>', { class: 'optionSetting' });
		$thisOptionContainer.append($thisLabel);
		$thisOptionContainer.append($thisOptionSetting);
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
			if (option.value.length > 67 /* 68 or more rows is the very very definition of a very long table */) $thisOptionSetting.addClass('wholeTableVisible');
			const thisThead = document.createElement('thead');
			const thisTableHeader = document.createElement('tr');
			let thisTH;
			thisTable.appendChild(thisThead);
			option.fields.forEach(field => {
				thisTH = document.createElement('th');
				$(thisTH).text(i18n(field.name));
				thisTableHeader.appendChild(thisTH);
				if (field.type === 'hidden') thisTH.hidden = true;
			});
			if (!isFixed) {
				// add delete column
				thisTH = document.createElement('th');
				thisTableHeader.appendChild(thisTH);
				// add move column
				thisTH = document.createElement('th');
				$(thisTableHeader).prepend(thisTH);
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

			$thisOptionDescription.insertAfter($thisLabel);
			if (!isFixed) {
				// Create an "add row" button...
				const addRowButton = $('<button class="addRowButton"></button>')
					.text(i18n(option.addRowText || 'settingsConsoleDefaultAddRowText'))
					.get(0);
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
					$(thisTbody).trigger('change');
				}, true);

				$(addRowButton).insertAfter($thisOptionSetting);

				Sortable.create(thisTbody, { handle: '.handle' });
			}
		} else if (option.type === 'builder') {
			$thisOptionContainer.addClass('specialOptionType');
			$thisOptionDescription.insertAfter($thisLabel);
			thisOptionFormEle = caseBuilder.drawOptionBuilder(thisOptions, mod, optionKey);
		} else {
			if ((option.type === 'text') || (option.type === 'password') || (option.type === 'keycode')) {
				$thisOptionDescription.addClass('textInput');
			}
			thisOptionFormEle = drawOptionInput(mod, optionKey, option);
			$thisOptionContainer.append($thisOptionDescription);
		}
		$thisOptionSetting.append(thisOptionFormEle);
		return $thisOptionContainer.get(0);
	}).filter(Boolean));

	RESConfigPanelOptions.querySelector('#noOptions').style.display = 'none';
	// Detach any stale scrim from the previous module before we either skip
	// (no options) or create a fresh one. Without this, the previous call's
	// scrim jQuery wrapper points into a detached DOM subtree and subsequent
	// `.toggleClass` calls in `updateCurrentModuleState` silently mutate a
	// ghost.
	$moduleOptionsScrim = undefined;
	if (!optCount && mod.alwaysEnabled) {
		// do nothing
	} else if (optCount === 0) {
		RESConfigPanelOptions.querySelector('#noOptions').style.display = 'block';
	} else {
		$moduleOptionsScrim = $('<div>', { id: 'moduleOptionsScrim' })
			.toggleClass('visible', !getModuleEnabled(mod.moduleID))
			.appendTo(allOptionsContainer);
	}

	function addTableButtons(thisTR) {
		// add delete button
		let thisTD = document.createElement('td');
		const thisDeleteButton = document.createElement('button');
		thisDeleteButton.className = 'res-icon-button res-icon deleteButton';
		thisDeleteButton.type = 'button';
		thisDeleteButton.textContent = '\uF056';
		thisDeleteButton.title = 'remove this row';
		thisDeleteButton.setAttribute('aria-label', 'Remove this row');

		thisDeleteButton.addEventListener('click', () => {
			const tbody = downcast(thisTR.closest('tbody'), HTMLTableSectionElement);
			$(thisTR).trigger('change').detach();
			CreateElement.undo('Restore deleted row').then(() => { $(thisTR).appendTo(tbody).trigger('change'); });
		});
		thisTD.appendChild(thisDeleteButton);
		thisTR.appendChild(thisTD);

		// add move handle
		thisTD = document.createElement('td');
		const thisHandle = document.createElement('button');
		thisHandle.className = 'res-icon-button res-icon handle';
		thisHandle.type = 'button';
		thisHandle.textContent = '\uF0AA';
		thisHandle.title = 'drag and drop to move this row';
		thisHandle.setAttribute('aria-label', 'Drag and drop to move this row');

		thisTD.appendChild(thisHandle);
		thisTR.prepend(thisTD);
	}
}

const autostageDebounce = frameDebounce(stageCurrentModuleOptions);

function stageCurrentModuleOptions() {
	const panelOptionsDiv = RESConfigPanelOptions;
	// first, go through inputs that aren't of a specialized type like table or builder
	$(panelOptionsDiv)
		.find('.optionContainer:not(.specialOptionType)')
		.find('input, select, textarea')
		.each((i, e) => {
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
		});
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

	$(panelOptionsDiv).find('.optionBuilder').each(function(i, builder) {
		const moduleId = this.dataset.moduleId;
		const optionName = this.dataset.optionName;

		const { customOptionsFields, cases } = Modules.get(moduleId).options[optionName];

		const items = [];
		$(builder).find('.builderItem').each(function() {
			try {
				items.push(caseBuilder.readBuilderItem(this, customOptionsFields, cases));
			} catch (e) {
				console.error('Ignoring invalid item.', e);
			}
		});
		Options.stage.add(moduleId, optionName, items);
	});

	updateSaveButton();
	updateDependsOn(currentModule);
}

function updateSaveButton() {
	const { optionCount, moduleCount, scopeCount } = Options.stage.getCounts();
	const changeCount = optionCount + moduleCount;
	const unsavedOptions = changeCount > 0;
	const defaultSaveLabel = i18n('saveOptions');

	clearTimeout(saveStatusTimer);

	RESConsoleContainer.classList.toggle('has-unsaved-options', unsavedOptions);
	if (saveButton) {
		saveButton.disabled = !unsavedOptions;
		$(saveButton).toggleClass('optionsSaved', !unsavedOptions);
		saveButton.textContent = unsavedOptions ? `Save ${changeCount} Change${changeCount === 1 ? '' : 's'}` : defaultSaveLabel;
		saveButton.setAttribute('aria-label', unsavedOptions ? `Save ${changeCount} staged change${changeCount === 1 ? '' : 's'}` : defaultSaveLabel);
		saveButton.setAttribute('title', unsavedOptions ? `Save ${changeCount} staged change${changeCount === 1 ? '' : 's'}` : defaultSaveLabel);
	}

	if (discardButton) {
		discardButton.hidden = !unsavedOptions;
		discardButton.disabled = !unsavedOptions;
	}

	if (globalStageBar) {
		const text = globalStageBar.querySelector('.globalStageText');
		if (text instanceof HTMLElement) text.textContent = getWorkspaceStageSummary(changeCount, scopeCount);
		globalStageBar.classList.remove('is-saved-pulse');
		globalStageBar.classList.toggle('is-dirty', unsavedOptions);
		globalStageBar.classList.toggle('is-saved', !unsavedOptions);
	}

	updateModuleStageMarkers();
	updateFilterChipCounts();
}

function updateDependsOn(mod) {
	const stagedOptions = getOptions(mod);
	for (const [optionKey, { dependsOn }] of Object.entries(stagedOptions)) {
		if (dependsOn) $(`#optionContainer-${mod.moduleID}-${optionKey}`).toggleClass('dependsOnDisabledOptions', !dependsOn(stagedOptions));
	}
}

function handleEscapeKey(event: KeyboardEvent) {
	if (event.key === NAMED_KEYS.Escape) {
		close();
	}
}

const abandonChangesConfirmation = 'Abandon your changes to RES settings?';

function handleBeforeUnload() {
	if (Options.stage.isDirty()) {
		return abandonChangesConfirmation;
	}
}

async function close({ promptIfStagedOptions = true }: {| promptIfStagedOptions?: boolean |} = {}) {
	if (promptIfStagedOptions && Options.stage.isDirty()) {
		await Alert.open(abandonChangesConfirmation, { cancelable: true });
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
		cat.classList.toggle('is-filtered-out', visibleKids.length === 0);
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
	// New behaviour: all categories stay expanded by default; we only mark the
	// selected category as `.active` so the highlight can follow the chosen
	// module. Siblings are NOT collapsed — users asked to stop the accordion
	// dance where selecting a module in one category closed all the others.
	const items = $(RESConsoleContainer).find('#RESConfigPanelModulesList .RESConfigPanelCategory');
	const selected = items.filter(`[data-category="${category}"]`);
	items.removeClass('active');
	selected.addClass('active').addClass('is-expanded').find('.categoryButton').attr('aria-expanded', 'true');
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
	if (text instanceof HTMLElement) text.textContent = 'Saved just now';
	globalStageBar.classList.remove('is-dirty');
	globalStageBar.classList.add('is-saved', 'is-saved-pulse');
	clearTimeout(saveStatusTimer);
	saveStatusTimer = setTimeout(() => { updateSaveButton(); }, 1500);
}
