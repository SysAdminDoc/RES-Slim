/* @flow */

import { RES_SETTINGS_HASH } from '../constants/urlHashes';
import { i18n } from '../environment';
import { string } from '../utils';

const settingsThemeOptions = [
	{ id: 'graphite', labelKey: 'settingsConsoleThemeGraphite' },
	{ id: 'midnight', labelKey: 'settingsConsoleThemeMidnight' },
	{ id: 'forest', labelKey: 'settingsConsoleThemeForest' },
	{ id: 'ember', labelKey: 'settingsConsoleThemeEmber' },
];

export const consoleContainerTemplate = ({ name, version, showAllOptions }: {| name: string, version: string, showAllOptions: boolean |}) => string.html`
	<div id="RESConsoleContainer" class="${showAllOptions ? 'advanced-options-enabled' : ''}">
		<div id="RESConsoleHeader">
			<div id="RESConsoleTopBar" class="RESDialogTopBar">
				<div class="consoleBrandBlock">
					<a class="res-logo" href="${RES_SETTINGS_HASH}" aria-label="${i18n('settingsConsoleHomeAria', name)}"></a>
					<div class="consoleBrandText">
						<div class="consoleTitleRow">
							<h1>${name}</h1>
							<div id="RESConsoleVersionDisplay" translate="no">v${version}</div>
						</div>
						<p class="consoleSubtitle">${i18n('settingsConsoleSubtitle')}</p>
					</div>
				</div>

				<div class="consoleHeaderActions">
					<div id="RESThemeSelector" class="themeSelector" role="group" aria-label="${i18n('settingsConsoleThemeGroup')}">
						<span class="themeSelectorLabel">${i18n('settingsConsoleThemeLabel')}</span>
						<div class="themeSelectorOptions">
							${settingsThemeOptions.map(({ id, labelKey }) => string._html`
								<button
									type="button"
									class="themeOption ${id === 'graphite' ? 'is-active' : ''}"
									data-settings-theme="${id}"
									aria-pressed="${id === 'graphite' ? 'true' : 'false'}"
									aria-label="${i18n('settingsConsoleApplyTheme', i18n(labelKey))}"
									title="${i18n('settingsConsoleApplyTheme', i18n(labelKey))}"
								>
									<span class="themeOptionSwatch themeOptionSwatch--${id}" aria-hidden="true"></span>
									<span class="themeOptionText">${i18n(labelKey)}</span>
								</button>
							`)}
						</div>
					</div>
					<button id="RESMobileSidebarToggle" type="button" class="sidebarToggleButton" aria-controls="RESConfigPanelModulesPane" aria-expanded="true">${i18n('settingsConsoleHideModules')}</button>
					<div id="RESGlobalStageBar" class="globalStageBar is-saved" role="status" aria-live="polite">
						<span class="globalStageIcon" aria-hidden="true"></span>
						<span class="globalStageText">${i18n('settingsConsoleAllChangesSaved')}</span>
					</div>
					<button id="RESGlobalDiscard" type="button" class="globalDiscardButton" hidden aria-label="${i18n('settingsConsoleDiscardStagedChanges')}">${i18n('settingsConsoleDiscard')}</button>
					<button id="RESGlobalSave" type="button" class="globalSaveButton" disabled>${i18n('settingsConsoleSaveDefault')}</button>
					<button id="RESClose" type="button" aria-label="${i18n('settingsConsoleClose')}" class="RESCloseButton RESCloseButtonTopRight"></button>
				</div>
			</div>
		</div>

		<div id="RESConsoleContent">
			<aside id="RESConfigPanelModulesPane" aria-label="${i18n('settingsConsoleModulesAria')}">
				<section class="sidebarSearchBlock">
					<div class="sidebarSectionHeader">
						<div class="sidebarSectionHeaderCopy">
							<span class="sidebarSectionTitle">${i18n('settingsConsoleFindTitle')}</span>
							<span class="sidebarSectionMeta">${i18n('settingsConsoleFindMeta')}</span>
						</div>
					</div>
					<label class="srOnly" for="SearchRES-input">${i18n('settingsConsoleFindLabel')}</label>
					<div id="SearchRES-input-container"></div>
					<div id="RESFilterChips" class="filterChips" role="group" aria-label="${i18n('settingsConsoleFilterGroup')}">
						<button type="button" class="filterChip is-active" data-filter="all" aria-pressed="true">
							<span class="filterChipLabel">${i18n('settingsConsoleFilterAll')}</span>
							<span class="filterChipCount" data-count="all">0</span>
						</button>
						<button type="button" class="filterChip" data-filter="enabled" aria-pressed="false">
							<span class="filterChipLabel">${i18n('settingsConsoleFilterOn')}</span>
							<span class="filterChipCount" data-count="enabled">0</span>
						</button>
						<button type="button" class="filterChip" data-filter="disabled" aria-pressed="false">
							<span class="filterChipLabel">${i18n('settingsConsoleFilterOff')}</span>
							<span class="filterChipCount" data-count="disabled">0</span>
						</button>
						<button type="button" class="filterChip" data-filter="modified" aria-pressed="false">
							<span class="filterChipLabel">${i18n('settingsConsoleFilterModified')}</span>
							<span class="filterChipCount" data-count="modified">0</span>
						</button>
					</div>
				</section>

				<section class="sidebarListBlock">
					<div class="sidebarSectionHeader">
						<div class="sidebarSectionHeaderCopy">
							<span class="sidebarSectionTitle">${i18n('settingsConsoleModulesTitle')}</span>
							<span id="RESModuleLibraryMeta" class="sidebarSectionMeta">${i18n('settingsConsoleBrowseByCategory')}</span>
						</div>
						<span id="RESModuleCountBadge" class="sidebarCountBadge"></span>
					</div>
					<div id="RESConfigPanelModulesEmpty" class="sidebarEmptyState" hidden role="status">
						<p class="sidebarEmptyStateTitle">${i18n('settingsConsoleNoModulesMatch')}</p>
						<button type="button" class="sidebarEmptyStateReset" data-filter="all">${i18n('settingsConsoleShowAllModules')}</button>
					</div>
					<div id="RESConfigPanelModulesList"></div>
				</section>

				<label id="RESAllOptionsSpan" class="advancedOptionsPanel">
					<span class="advancedOptionsCopy">
						<strong>${i18n('showAdvancedOptions')}</strong>
						<small>${i18n('settingsConsoleAdvancedMeta')}</small>
					</span>
					<input id="RESAllOptions" type="checkbox" ${showAllOptions ? 'checked' : ''}>
				</label>
			</aside>
			<main id="RESConfigPanelOptions">
				<section class="workspaceShell">
					<header class="moduleHeader">
						<div class="moduleMetaRow">
							<span class="moduleCategoryBadge">${i18n('settingsConsoleCategoryPlaceholder')}</span>
							<span id="moduleStateBadge" class="moduleStateBadge">${i18n('settingsConsoleStateEnabled')}</span>
						</div>
						<div class="moduleHeaderTopRow">
							<div class="moduleHeaderCopy">
								<h2 class="moduleName">${i18n('settingsConsoleModuleNamePlaceholder')}</h2>
								<div id="moduleOptionSummary" class="moduleOptionSummary"></div>
							</div>
							<div class="moduleHeaderUtility">
								<button type="button" class="moduleToggle toggleButton enabled" data-module="moduleID" aria-pressed="true" aria-label="${i18n('settingsConsoleDisableModuleAction', i18n('settingsConsoleModuleNamePlaceholder'))}">
									<span class="toggleThumb" aria-hidden="true"></span>
									<span class="toggleLabel" data-enabled-text="${i18n('toggleOn')}" data-disabled-text="${i18n('toggleOff')}" aria-hidden="true"></span>
								</button>
							</div>
						</div>
					</header>
					<div class="moduleDescription"></div>
					<section class="workspaceCanvas">
						<div id="allOptionsContainer"></div>
						<div id="noOptions" class="workspaceEmptyState" role="status">
							${i18n('settingsConsoleNoModuleOptions')}
						</div>
					</section>
				</section>
			</main>
		</div>
	</div>
`;

export const moduleSelectorTemplate = (categories: Array<{ name: string, translatedName: string, modules: Array<{ isEnabled: boolean, alwaysEnabled: boolean, moduleID: string, translatedName: string, description: string, shortDescription: string }> }>) => string.html`
	<ul class="moduleCategoryGroups">
		${categories.map(({ name, translatedName, modules }) => string._html`
			<li class="RESConfigPanelCategory is-expanded" data-category="${name}">
				<h3 class="categoryHeading">
					<span class="categoryHeadingLabel">${translatedName}</span>
					<span class="categoryCount">${modules.length}</span>
				</h3>
				<ul class="categoryModules">
					${modules.map(({ isEnabled, alwaysEnabled, moduleID, translatedName, description, shortDescription }) => string._html`
						<li class="moduleRow ${isEnabled ? 'is-enabled' : ''} ${alwaysEnabled ? 'is-locked' : ''}" data-module-id="${moduleID}">
							<button type="button" class="moduleButton ${isEnabled ? 'enabled' : ''}" data-module="${moduleID}" title="${description}">
								<span class="moduleButtonHeader">
									<span class="moduleButtonTitle">${translatedName}</span>
									<span class="moduleButtonStage" hidden aria-hidden="true"></span>
								</span>
								<small>${shortDescription}</small>
							</button>
							${alwaysEnabled ? string._html`
								<span class="moduleRowLock" aria-label="${i18n('settingsConsoleStateAlwaysOn')}" title="${i18n('settingsConsoleStateAlwaysOn')}">${i18n('settingsConsoleFilterOn')}</span>
							` : string._html`
								<button type="button" class="moduleRowToggle ${isEnabled ? 'is-on' : ''}" data-module-toggle="${moduleID}" aria-pressed="${isEnabled ? 'true' : 'false'}" aria-label="${isEnabled ? i18n('settingsConsoleDisableModuleAction', translatedName) : i18n('settingsConsoleEnableModuleAction', translatedName)}" title="${isEnabled ? i18n('settingsConsoleDisableModuleAction', translatedName) : i18n('settingsConsoleEnableModuleAction', translatedName)}">
									<span class="moduleRowToggleThumb" aria-hidden="true"></span>
								</button>
							`}
						</li>
					`)}
				</ul>
			</li>
		`)}
	</ul>
`;
