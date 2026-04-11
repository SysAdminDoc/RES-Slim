/* @flow */

import { RES_SETTINGS_HASH } from '../constants/urlHashes';
import { i18n } from '../environment';
import { string } from '../utils';

export const consoleContainerTemplate = ({ name, version, showAllOptions }: {| name: string, version: string, showAllOptions: boolean |}) => string.html`
	<div id="RESConsoleContainer" class="${showAllOptions ? 'advanced-options-enabled' : ''}">
		<div id="RESConsoleHeader">
			<div id="RESConsoleTopBar" class="RESDialogTopBar">
				<div class="consoleBrandBlock">
					<a class="res-logo" href="${RES_SETTINGS_HASH}" aria-label="${name} settings home"></a>
					<div class="consoleBrandText">
						<div class="consoleTitleRow">
							<h1>${name}</h1>
							<div id="RESConsoleVersionDisplay" translate="no">v${version}</div>
						</div>
					</div>
				</div>

				<div class="consoleHeaderActions">
					<div id="RESGlobalStageBar" class="globalStageBar is-saved" role="status" aria-live="polite">
						<span class="globalStageIcon" aria-hidden="true"></span>
						<span class="globalStageText">All changes saved</span>
					</div>
					<button id="RESGlobalDiscard" type="button" class="globalDiscardButton" hidden aria-label="Discard staged changes">Discard</button>
					<button id="RESGlobalSave" type="button" class="globalSaveButton" disabled>${i18n('saveOptions')}</button>
					<button id="RESClose" type="button" aria-label="Close settings" class="RESCloseButton RESCloseButtonTopRight"></button>
				</div>
			</div>
		</div>

		<div id="RESConsoleContent">
			<aside id="RESConfigPanelModulesPane" aria-label="Settings modules">
				<div class="sidebarDeck">
					<section class="sidebarSection sidebarCommandDeck">
						<div class="sidebarSectionHeader">
							<div class="sidebarSectionHeaderCopy">
								<span class="sidebarSectionTitle">Find</span>
							</div>
						</div>
						<label class="srOnly" for="SearchRES-input">Find a Setting</label>
						<div id="SearchRES-input-container"></div>
						<div id="RESFilterChips" class="filterChips" role="tablist" aria-label="Filter modules">
							<button type="button" class="filterChip is-active" data-filter="all" role="tab" aria-selected="true">
								<span class="filterChipLabel">All</span>
								<span class="filterChipCount" data-count="all">0</span>
							</button>
							<button type="button" class="filterChip" data-filter="enabled" role="tab" aria-selected="false">
								<span class="filterChipLabel">On</span>
								<span class="filterChipCount" data-count="enabled">0</span>
							</button>
							<button type="button" class="filterChip" data-filter="disabled" role="tab" aria-selected="false">
								<span class="filterChipLabel">Off</span>
								<span class="filterChipCount" data-count="disabled">0</span>
							</button>
							<button type="button" class="filterChip" data-filter="modified" role="tab" aria-selected="false">
								<span class="filterChipLabel">Modified</span>
								<span class="filterChipCount" data-count="modified">0</span>
							</button>
						</div>
					</section>

					<section class="sidebarSection sidebarModules">
						<div class="sidebarSectionHeader">
							<div class="sidebarSectionHeaderCopy">
								<span class="sidebarSectionTitle">Modules</span>
								<span id="RESModuleLibraryMeta" class="sidebarSectionMeta">Browse by category</span>
							</div>
							<span id="RESModuleCountBadge" class="sidebarCountBadge"></span>
						</div>
						<div id="RESConfigPanelModulesList"></div>
					</section>

					<section class="sidebarSection sidebarFooter">
						<label id="RESAllOptionsSpan" class="advancedOptionsPanel">
							<span class="advancedOptionsCopy">
								<strong>${i18n('showAdvancedOptions')}</strong>
								<small>Include expert settings in the workspace and in search.</small>
							</span>
							<input id="RESAllOptions" type="checkbox" ${showAllOptions ? 'checked' : ''}>
						</label>
					</section>
				</div>
			</aside>
			<main id="RESConfigPanelOptions">
				<div class="workspaceScroll">
					<section class="workspaceShell">
						<header class="moduleHeader">
							<div class="moduleHeaderTopRow">
								<div class="moduleHeaderCopy">
									<div class="moduleMetaRow">
										<span class="moduleCategoryBadge">Category</span>
										<span id="moduleStateBadge" class="moduleStateBadge">Enabled</span>
									</div>
									<h2 class="moduleName">Module Name</h2>
									<div id="moduleOptionSummary" class="moduleOptionSummary"></div>
								</div>
								<div class="moduleHeaderUtility">
									<button type="button" class="moduleToggle toggleButton enabled" data-module="moduleID" aria-pressed="true" aria-label="Disable module">
										<span class="toggleThumb" aria-hidden="true"></span>
										<span class="toggleLabel" data-enabled-text="${i18n('toggleOn')}" data-disabled-text="${i18n('toggleOff')}" aria-hidden="true"></span>
									</button>
								</div>
							</div>
						</header>
						<section class="workspaceCanvas">
							<div class="moduleDescription"></div>
							<div id="allOptionsContainer"></div>
							<div id="noOptions" class="workspaceEmptyState" role="status">
								There are no configurable options for this module.
							</div>
						</section>
					</section>
				</div>
			</main>
		</div>
	</div>
`;

export const moduleSelectorTemplate = (categories: Array<{ name: string, translatedName: string, modules: Array<{ isEnabled: boolean, alwaysEnabled: boolean, moduleID: string, translatedName: string, description: string, shortDescription: string }> }>) => string.html`
	<ul>
		${categories.map(({ name, translatedName, modules }) => string._html`
			<li class="RESConfigPanelCategory is-expanded" data-category="${name}">
				<h3>
					<button type="button" class="categoryButton" aria-expanded="true">
						<span class="categoryButtonChevron" aria-hidden="true"></span>
						<span class="categoryButtonLabel">${translatedName}</span>
						<span class="categoryCount">${modules.length}</span>
					</button>
				</h3>
				<ul>
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
								<span class="moduleRowLock" aria-label="Always on" title="Always on">•</span>
							` : string._html`
								<button type="button" class="moduleRowToggle ${isEnabled ? 'is-on' : ''}" data-module-toggle="${moduleID}" aria-pressed="${isEnabled ? 'true' : 'false'}" aria-label="${isEnabled ? 'Disable' : 'Enable'} ${translatedName}" title="${isEnabled ? 'Disable' : 'Enable'} ${translatedName}">
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
