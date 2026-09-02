/* @flow */

import { RES_SETTINGS_HASH } from '../constants/urlHashes';
import { DEFAULT_SETTINGS_THEME, SETTINGS_THEME_CHOICES } from '../constants/settingsThemes';
import { CONSOLE_PREFS_TAB_ID, DATA_WORKSPACE_TAB_ID, SEARCH_TAB_ID } from '../constants/settingsCategories';
import { i18n } from '../environment';
import { string } from '../utils';

const CATEGORY_TAB_ICONS: { [category: string]: string } = {
	appearanceCategory: '◒',
	commentsCategory: '○',
	submissionsCategory: '▤',
	subredditsCategory: 'r/',
	usersCategory: '◇',
	myAccountCategory: '▣',
	browsingCategory: '◎',
	productivityCategory: 'ϟ',
	privacyCategory: '⬡',
	coreCategory: '⌘',
	aboutCategory: 'i',
};

export const consoleContainerTemplate = ({ name, version, showAllOptions }: {| name: string, version: string, showAllOptions: boolean |}) => string.html`
	<div id="RESConsoleContainer" class="${showAllOptions ? 'advanced-options-enabled' : ''}">
		<aside id="RESPrimaryRail" aria-label="${i18n('settingsConsoleTabsAria')}">
			<div class="consoleBrandBlock">
				<a class="res-logo" href="${RES_SETTINGS_HASH}" aria-label="${i18n('settingsConsoleHomeAria', name)}"></a>
				<div class="consoleBrandText">
					<div class="consoleTitleRow">
						<h1>${name}</h1>
					</div>
					<p class="consoleSubtitle">${i18n('settingsConsoleSubtitle')}</p>
				</div>
			</div>

			<section class="sidebarSearchBlock">
				<label class="srOnly" for="SearchRES-input">${i18n('settingsConsoleFindLabel')}</label>
				<div id="SearchRES-input-container"></div>
			</section>

			<nav id="RESCategoryTabs" class="categoryTabs" role="tablist" aria-label="${i18n('settingsConsoleTabsAria')}"></nav>
		</aside>

		<header id="RESConsoleHeader">
			<div id="RESConsoleTopBar" class="RESDialogTopBar">
				<div id="RESHeaderCategory" class="consoleRailHeading">${i18n('appearanceCategory')}</div>
				<div id="RESConsoleBreadcrumb" class="consoleBreadcrumb" aria-live="polite">
					<span id="RESBreadcrumbCategory" class="consoleBreadcrumbCategory">${i18n('appearanceCategory')}</span>
					<span class="consoleBreadcrumbSeparator" aria-hidden="true">/</span>
					<strong id="RESBreadcrumbModule" class="consoleBreadcrumbModule">${i18n('settingsConsoleModuleNamePlaceholder')}</strong>
				</div>

				<div class="consoleHeaderActions">
					<div id="RESGlobalStageBar" class="globalStageBar is-saved" role="status" aria-live="polite">
						<span class="globalStageIcon" aria-hidden="true"></span>
						<span class="globalStageText">${i18n('settingsConsoleAllChangesSaved')}</span>
					</div>
					<div class="consoleControlGroup consoleControlGroup--changes" role="group" aria-label="${i18n('settingsConsoleChangesGroup')}">
						<button id="RESGlobalDiscard" type="button" class="globalDiscardButton" hidden aria-label="${i18n('settingsConsoleDiscardStagedChanges')}">${i18n('settingsConsoleDiscard')}</button>
						<button id="RESGlobalSave" type="button" class="globalSaveButton" disabled>${i18n('settingsConsoleSaveDefault')}</button>
					</div>
					<button id="RESMobileSidebarToggle" type="button" class="sidebarToggleButton" aria-controls="RESConfigPanelModulesPane" aria-expanded="true">${i18n('settingsConsoleHideModules')}</button>
					<button id="RESClose" type="button" aria-label="${i18n('settingsConsoleClose')}" class="RESCloseButton RESCloseButtonTopRight"></button>
				</div>
			</div>
		</header>

		<div id="RESConsoleContent">
			<aside id="RESConfigPanelModulesPane" aria-label="${i18n('settingsConsoleModulesAria')}">
				<section class="sidebarListBlock">
					<div class="sidebarSectionHeader">
						<div class="sidebarSectionHeaderCopy">
							<span id="RESActiveCategoryTitle" class="sidebarSectionTitle">${i18n('settingsConsoleModulesTitle')}</span>
							<span id="RESModuleLibraryMeta" class="sidebarSectionMeta">${i18n('settingsConsoleBrowseByCategory')}</span>
						</div>
						<span id="RESModuleCountBadge" class="sidebarCountBadge"></span>
					</div>
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
					<div id="RESConfigPanelModulesEmpty" class="sidebarEmptyState" hidden role="status">
						<p class="sidebarEmptyStateTitle">${i18n('settingsConsoleNoModulesMatch')}</p>
						<button type="button" class="sidebarEmptyStateReset" data-filter="all">${i18n('settingsConsoleShowAllModules')}</button>
					</div>
					<div id="RESConfigPanelModulesList"></div>
				</section>
			</aside>
			<main id="RESConfigPanelOptions">
				<!--
					Selector drift. Empty and hidden unless something actually drifted:
					old Reddit's markup is what this fork stands on, so a surface that
					has quietly fallen back to a secondary selector is worth seeing at a
					glance instead of as one line in an undifferentiated error log — but
					a diagnostics panel that is always present is furniture, and stops
					being read long before it has anything to say.
				-->
				<section id="RESSelectorDrift" class="selectorDriftPanel" hidden aria-labelledby="RESSelectorDriftTitle">
					<header class="selectorDriftHeader">
						<h2 id="RESSelectorDriftTitle" class="selectorDriftTitle"></h2>
						<div class="selectorDriftActions">
							<button id="RESSelectorDriftCopy" type="button" class="selectorDriftButton">${i18n('selectorDriftCopyReport')}</button>
							<button id="RESSelectorDriftClear" type="button" class="selectorDriftButton selectorDriftButton--quiet">${i18n('selectorDriftClear')}</button>
						</div>
					</header>
					<p class="selectorDriftSummary">${i18n('selectorDriftSummary')}</p>
					<div id="RESSelectorDriftList" class="selectorDriftList"></div>
					<p id="RESSelectorDriftStatus" class="selectorDriftStatus" role="status" aria-live="polite"></p>
				</section>
				<section id="RESModuleWorkspace" class="workspaceShell" role="tabpanel">
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
					<aside id="RESModuleContextNote" class="moduleContextNote" hidden></aside>
					<section class="workspaceCanvas">
						<div id="allOptionsContainer"></div>
						<div id="noOptions" class="workspaceEmptyState" role="status">
							<span class="workspaceEmptyStateIcon" aria-hidden="true"></span>
							<strong>${i18n('settingsConsoleNoConfigurableOptions')}</strong>
							<span>${i18n('settingsConsoleNoModuleOptions')}</span>
						</div>
					</section>
				</section>
			</main>
			<section id="RESConsolePrefs" class="consolePrefsShell" role="tabpanel" hidden>
				<header class="consolePrefsHeader">
					<h2 class="consolePrefsTitle">${i18n('settingsConsoleConsolePrefsTitle')}</h2>
					<p class="consolePrefsSummary">${i18n('settingsConsoleConsolePrefsSummary')}</p>
				</header>
				<div class="consolePrefsGrid">
					<section class="utilityPanel utilityPanel--display">
						<div class="utilityPanelHeader">
							<span class="utilityPanelTitle">${i18n('settingsConsoleDisplayTitle')}</span>
							<span class="utilityPanelMeta">${i18n('settingsConsoleDisplayMeta')}</span>
						</div>
						<div class="consoleControlGroup consoleControlGroup--themes">
							<div id="RESThemeSelector" class="themeSelector" role="group" aria-label="${i18n('settingsConsoleThemeGroup')}">
								<span class="themeSelectorLabel">${i18n('settingsConsoleThemeLabel')}</span>
								<div class="themeSelectorOptions">
									${SETTINGS_THEME_CHOICES.map(({ id, labelKey }) => string._html`
										<button
											type="button"
											class="themeOption ${id === DEFAULT_SETTINGS_THEME ? 'is-active' : ''}"
											data-settings-theme="${id}"
											aria-pressed="${id === DEFAULT_SETTINGS_THEME ? 'true' : 'false'}"
											aria-label="${i18n('settingsConsoleApplyTheme', i18n(labelKey))}"
											title="${i18n('settingsConsoleApplyTheme', i18n(labelKey))}"
										>
											<span class="themeOptionSwatch themeOptionSwatch--${id}" aria-hidden="true"></span>
											<span class="themeOptionText">${i18n(labelKey)}</span>
										</button>
									`)}
								</div>
							</div>
						</div>
						<div class="consoleControlGroup consoleControlGroup--display" role="group" aria-label="${i18n('settingsConsoleDisplayGroup')}">
							<button id="RESDensityToggle" type="button" class="densityToggle" aria-pressed="false">
								<span class="consolePreferenceLabel">${i18n('settingsConsoleDensityLabel')}</span>
								<span id="RESDensityValue" class="consolePreferenceValue">${i18n('settingsConsoleDensityComfortable')}</span>
							</button>
							<button id="RESMotionToggle" type="button" class="motionToggle" aria-pressed="false" title="${i18n('settingsConsoleReduceMotion')}">
								<span class="consolePreferenceLabel">${i18n('settingsConsoleMotionLabel')}</span>
								<span id="RESMotionValue" class="consolePreferenceValue">${i18n('settingsConsoleMotionSystem')}</span>
							</button>
						</div>
					</section>

					<section class="utilityPanel utilityPanel--data">
						<div class="utilityPanelHeader">
							<span class="utilityPanelTitle">${i18n('settingsConsoleDataTitle')}</span>
							<span class="utilityPanelMeta">${i18n('settingsConsoleDataMeta')}</span>
						</div>
						<div class="utilityActionStack consoleControlGroup" role="group" aria-label="${i18n('settingsConsoleSettingsFileGroup')}">
							<button id="RESSettingsExport" type="button" class="settingsIoButton" title="${i18n('settingsConsoleExportTitle')}">${i18n('settingsConsoleExport')}</button>
							<button id="RESSettingsImport" type="button" class="settingsIoButton" title="${i18n('settingsConsoleImportTitle')}">${i18n('settingsConsoleImport')}</button>
							<button id="RESSettingsReset" type="button" class="settingsIoButton" title="${i18n('settingsConsoleResetTitle')}">${i18n('settingsConsoleReset')}</button>
							<input id="RESSettingsImportFile" type="file" accept="application/json,.json" hidden>
						</div>
					</section>

					<section id="RESModuleErrorLogPanel" class="utilityPanel utilityPanel--errors">
						<div class="utilityPanelHeader">
							<span class="utilityPanelTitle">${i18n('settingsConsoleErrorsTitle')}</span>
							<span class="utilityPanelMeta">${i18n('settingsConsoleErrorsMeta')}</span>
						</div>
						<div class="utilityActionStack consoleControlGroup" role="group" aria-label="${i18n('settingsConsoleErrorsGroup')}">
							<button id="RESModuleErrorLogRefresh" type="button" class="settingsIoButton">${i18n('settingsConsoleErrorsRefresh')}</button>
							<button id="RESModuleErrorLogCopy" type="button" class="settingsIoButton" disabled>${i18n('settingsConsoleErrorsCopy')}</button>
							<button id="RESModuleErrorLogClear" type="button" class="settingsIoButton" disabled>${i18n('settingsConsoleErrorsClear')}</button>
						</div>
						<textarea id="RESModuleErrorLogOutput" class="moduleErrorLogOutput" rows="8" readonly spellcheck="false" aria-label="${i18n('settingsConsoleErrorsAria')}" placeholder="${i18n('settingsConsoleErrorsEmpty')}"></textarea>
						<p id="RESModuleErrorLogStatus" class="moduleErrorLogStatus" role="status" aria-live="polite"></p>
					</section>

					<section class="utilityPanel utilityPanel--advanced">
						<div class="utilityPanelHeader">
							<span class="utilityPanelTitle">${i18n('settingsConsoleAdvancedTag')}</span>
							<span class="utilityPanelMeta">${i18n('settingsConsoleAdvancedMeta')}</span>
						</div>
						<label id="RESAllOptionsSpan" class="advancedOptionsPanel">
							<span class="advancedOptionsCopy">
								<strong>${i18n('showAdvancedOptions')}</strong>
							</span>
							<input id="RESAllOptions" type="checkbox" ${showAllOptions ? 'checked' : ''}>
						</label>
					</section>

					<section id="RESSupportDumpPanel" class="utilityPanel utilityPanel--support">
						<div class="utilityPanelHeader">
							<span class="utilityPanelTitle">${i18n('settingsConsoleSupportTitle')}</span>
							<span class="utilityPanelMeta">${i18n('settingsConsoleSupportMeta')}</span>
						</div>
						<div class="utilityActionStack consoleControlGroup" role="group" aria-label="${i18n('settingsConsoleSupportGroup')}">
							<button id="RESSupportDumpBuild" type="button" class="settingsIoButton">${i18n('settingsConsoleSupportBuild')}</button>
							<button id="RESSupportDumpCopy" type="button" class="settingsIoButton" disabled>${i18n('settingsConsoleSupportCopy')}</button>
						</div>
						<textarea id="RESSupportDumpOutput" class="moduleErrorLogOutput" rows="10" readonly spellcheck="false" aria-label="${i18n('settingsConsoleSupportAria')}" placeholder="${i18n('settingsConsoleSupportEmpty')}"></textarea>
						<p id="RESSupportDumpStatus" class="moduleErrorLogStatus" role="status" aria-live="polite"></p>
					</section>

					<section id="RESSelectorOverridePanel" class="utilityPanel utilityPanel--selectors" aria-labelledby="RESSelectorOverrideTitle">
						<div class="utilityPanelHeader">
							<span id="RESSelectorOverrideTitle" class="utilityPanelTitle">${i18n('selectorOverrideTitle')}</span>
							<span class="utilityPanelMeta">${i18n('selectorOverrideMeta')}</span>
						</div>
						<p class="selectorOverrideSummary">${i18n('selectorOverrideSummary')}</p>
						<label class="selectorOverrideLabel" for="RESSelectorOverrideEditor">${i18n('selectorOverrideLabel')}</label>
						<textarea id="RESSelectorOverrideEditor" class="selectorOverrideEditor" rows="12" spellcheck="false" aria-describedby="RESSelectorOverrideStatus"></textarea>
						<div class="utilityActionStack consoleControlGroup" role="group" aria-label="Selector override actions">
							<button id="RESSelectorOverrideSave" type="button" class="settingsIoButton">${i18n('selectorOverrideSave')}</button>
							<button id="RESSelectorOverrideImport" type="button" class="settingsIoButton">${i18n('selectorOverrideImport')}</button>
							<button id="RESSelectorOverrideExport" type="button" class="settingsIoButton">${i18n('selectorOverrideExport')}</button>
							<button id="RESSelectorOverrideReset" type="button" class="settingsIoButton">${i18n('selectorOverrideReset')}</button>
							<input id="RESSelectorOverrideFile" type="file" accept="application/json,.json" hidden>
						</div>
						<p id="RESSelectorOverrideStatus" class="selectorOverrideStatus" role="status" aria-live="polite"></p>
					</section>

					<section class="utilityPanel utilityPanel--build">
						<div class="utilityBuildLine">
							<span>${i18n('settingsConsoleBuildLabel')}</span>
							<strong id="RESConsoleVersionDisplay" translate="no">v${version}</strong>
						</div>
					</section>
				</div>
			</section>
			<section id="RESDataWorkspace" class="dataWorkspaceShell" role="tabpanel" hidden>
				<header class="dataWorkspaceHeader">
					<h2 class="dataWorkspaceTitle">${i18n('dataWorkspaceTitle')}</h2>
					<p class="dataWorkspaceSummary">${i18n('dataWorkspaceSummary')}</p>
				</header>
				<div class="dataWorkspaceControls">
					<label class="dataWorkspaceField" for="RESDataWorkspaceSet">
						<span>${i18n('dataWorkspaceSetLabel')}</span>
						<select id="RESDataWorkspaceSet" class="dataWorkspaceSelect"></select>
					</label>
					<label class="dataWorkspaceField" id="RESDataWorkspaceAccountLabel" for="RESDataWorkspaceAccount" hidden>
						<span>${i18n('dataWorkspaceAccountLabel')}</span>
						<select id="RESDataWorkspaceAccount" class="dataWorkspaceSelect" hidden></select>
					</label>
					<label class="dataWorkspaceField dataWorkspaceField--grow" for="RESDataWorkspaceSearch">
						<span>${i18n('dataWorkspaceSearchLabel')}</span>
						<input id="RESDataWorkspaceSearch" class="dataWorkspaceSearch" type="search" autocomplete="off" spellcheck="false" placeholder="${i18n('dataWorkspaceSearchPlaceholder')}">
					</label>
				</div>
				<div class="dataWorkspaceActions">
					<span id="RESDataWorkspaceCount" class="dataWorkspaceCount" role="status" aria-live="polite"></span>
					<button id="RESDataWorkspaceExport" type="button" class="settingsIoButton">${i18n('dataWorkspaceExport')}</button>
					<button id="RESDataWorkspacePurge" type="button" class="settingsIoButton settingsIoButton--danger">${i18n('dataWorkspacePurge')}</button>
					<button id="RESDataWorkspaceUndo" type="button" class="settingsIoButton" hidden></button>
				</div>
				<p id="RESDataWorkspaceStatus" class="dataWorkspaceStatus" role="status" aria-live="polite"></p>
				<ul id="RESDataWorkspaceRows" class="dataWorkspaceRows"></ul>
				<p id="RESDataWorkspaceMore" class="dataWorkspaceMore" hidden></p>
				<p id="RESDataWorkspaceEmpty" class="dataWorkspaceEmpty" role="status" hidden>${i18n('dataWorkspaceEmpty')}</p>
				<section id="RESDataWorkspaceImport" class="dataWorkspaceImport" aria-labelledby="RESDataWorkspaceImportTitle" hidden>
					<h3 id="RESDataWorkspaceImportTitle" class="dataWorkspaceImportTitle">${i18n('dataWorkspaceImportTitle')}</h3>
					<p class="dataWorkspaceImportHelp">${i18n('dataWorkspaceImportHelp')}</p>
					<label class="srOnly" for="RESDataWorkspaceImportPayload">${i18n('dataWorkspaceImportLabel')}</label>
					<textarea id="RESDataWorkspaceImportPayload" class="dataWorkspaceImportPayload" rows="6" spellcheck="false"></textarea>
					<div class="dataWorkspaceImportActions">
						<button id="RESDataWorkspaceImportPreview" type="button" class="settingsIoButton">${i18n('dataWorkspaceImportPreviewAction')}</button>
						<button id="RESDataWorkspaceImportCommit" type="button" class="settingsIoButton">${i18n('dataWorkspaceImportCommitAction')}</button>
					</div>
				</section>
			</section>
		</div>
	</div>
`;

// The category tabs are the console's primary navigation: one tab per
// category, in a fixed reading order, plus a trailing tab for the console's
// own preferences. Counts render here rather than in the sidebar so the whole
// shape of the settings is visible before you click anything.
export const categoryTabsTemplate = (categories: Array<{| name: string, label: string, count: number |}>) => string.html`
	<div class="categoryTabsInner">
		<div class="categoryTabsGroup">
			${categories.map(({ name, label, count }) => string._html`
				<button
					type="button"
					id="RESCategoryTab-${name}"
					class="categoryTab"
					role="tab"
					data-category="${name}"
					aria-selected="false"
					aria-controls="RESModuleWorkspace"
					tabindex="-1"
					aria-label="${i18n(count === 1 ? 'settingsConsoleTabModuleCountOne' : 'settingsConsoleTabModuleCountMany', label, count)}"
				>
					<span class="categoryTabIcon" aria-hidden="true">${CATEGORY_TAB_ICONS[name] || '·'}</span>
					<span class="categoryTabLabel">${label}</span>
					<span class="categoryTabCount" aria-hidden="true">${count}</span>
					<span class="categoryTabStageDot" aria-hidden="true" hidden></span>
				</button>
			`)}
		</div>
		<div class="categoryTabsGroup categoryTabsGroup--trailing">
			<button
				type="button"
				id="RESCategoryTab-search"
				class="categoryTab categoryTab--search"
				role="tab"
				data-category="${SEARCH_TAB_ID}"
				aria-selected="false"
				aria-controls="RESModuleWorkspace"
				tabindex="-1"
					hidden
				>
					<span class="categoryTabIcon" aria-hidden="true">?</span>
					<span class="categoryTabLabel">${i18n('settingsConsoleTabSearch')}</span>
				</button>
			<button
				type="button"
				id="RESCategoryTab-data"
				class="categoryTab categoryTab--data"
				role="tab"
				data-category="${DATA_WORKSPACE_TAB_ID}"
				aria-selected="false"
				aria-controls="RESDataWorkspace"
				tabindex="-1"
					title="${i18n('dataWorkspaceTabTitle')}"
				>
					<span class="categoryTabIcon" aria-hidden="true">&#9776;</span>
					<span class="categoryTabLabel">${i18n('dataWorkspaceTab')}</span>
			</button>
			<button
				type="button"
				id="RESCategoryTab-console"
				class="categoryTab categoryTab--console"
				role="tab"
				data-category="${CONSOLE_PREFS_TAB_ID}"
				aria-selected="false"
				aria-controls="RESConsolePrefs"
				tabindex="-1"
					title="${i18n('settingsConsoleTabConsoleTitle')}"
				>
					<span class="categoryTabIcon categoryTabIcon--console" aria-hidden="true">&gt;_</span>
					<span class="categoryTabLabel">${i18n('settingsConsoleTabConsole')}</span>
			</button>
		</div>
	</div>
`;

export const moduleSelectorTemplate = (categories: Array<{ name: string, translatedName: string, modules: Array<{ isEnabled: boolean, alwaysEnabled: boolean, moduleID: string, translatedName: string, description: string, shortDescription: string }> }>) => string.html`
	<ul class="moduleCategoryGroups">
		${categories.map(({ name, translatedName, modules }) => string._html`
			<li class="RESConfigPanelCategory" data-category="${name}">
				<h3 class="srOnly">${translatedName}</h3>
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
									<span class="moduleRowToggleText" data-enabled-text="${i18n('toggleOn')}" data-disabled-text="${i18n('toggleOff')}" aria-hidden="true"></span>
								</button>
							`}
						</li>
					`)}
				</ul>
			</li>
		`)}
	</ul>
`;
