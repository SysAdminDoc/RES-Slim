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
						<div class="consoleEyebrow">Settings</div>
						<div class="consoleTitleRow">
							<h1>${name}</h1>
							<div id="RESConsoleVersionDisplay" translate="no">v${version}</div>
						</div>
						<p class="consoleSubtitle">Search modules, adjust settings, and save when you are ready.</p>
					</div>
				</div>

				<div class="consoleHeaderActions">
					<a id="RESConsoleSubredditLink" href="/r/Enhancement" aria-label="Visit the RES subreddit" title="Visit the RES subreddit">/r/Enhancement</a>
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
								<span class="sidebarSectionEyebrow">Search</span>
								<span class="sidebarSectionTitle">Search Settings</span>
							</div>
							<span class="sidebarSectionHint">Type to open results</span>
						</div>
						<label class="srOnly" for="SearchRES-input">Find a Setting</label>
						<div id="SearchRES-input-container"></div>
						<p class="sidebarSearchHint">Search by module name, option name, or description.</p>

						<label id="RESAllOptionsSpan" class="advancedOptionsPanel">
							<span class="advancedOptionsCopy">
								<strong>${i18n('showAdvancedOptions')}</strong>
								<small>Include expert settings in the workspace and in search.</small>
							</span>
							<input id="RESAllOptions" type="checkbox" ${showAllOptions ? 'checked' : ''}>
						</label>
					</section>

					<section class="sidebarSection sidebarModules">
						<div class="sidebarSectionHeader">
							<div class="sidebarSectionHeaderCopy">
								<span class="sidebarSectionEyebrow">Browse</span>
								<span class="sidebarSectionTitle">Module Library</span>
								<span id="RESModuleLibraryMeta" class="sidebarSectionMeta">Browse by category</span>
							</div>
							<span id="RESModuleCountBadge" class="sidebarCountBadge"></span>
						</div>
						<div id="RESConfigPanelModulesList"></div>
					</section>
				</div>
			</aside>
			<main id="RESConfigPanelOptions">
				<div class="workspaceScroll">
					<section class="workspaceShell">
						<header class="moduleHeader">
							<div class="moduleHeaderTopRow">
								<div class="moduleHeaderCopy">
									<div class="moduleWorkspaceEyebrow">Current Module</div>
									<div class="moduleMetaRow">
										<span class="moduleCategoryBadge">Category</span>
										<span id="moduleStateBadge" class="moduleStateBadge">Enabled</span>
									</div>
									<h2 class="moduleName">Module Name</h2>
									<div id="moduleOptionSummary" class="moduleOptionSummary"></div>
								</div>
								<div class="moduleHeaderUtility">
									<div id="workspaceStageStatus" class="workspaceStageStatus" role="status" aria-live="polite">All changes saved</div>
									<div class="moduleActionRow">
										<button id="moduleOptionsSave" type="button">${i18n('saveOptions')}</button>
										<button type="button" class="moduleToggle toggleButton enabled" data-module="moduleID" aria-pressed="true" aria-label="Disable module">
											<span class="toggleThumb" aria-hidden="true"></span>
											<span class="toggleLabel" data-enabled-text="${i18n('toggleOn')}" data-disabled-text="${i18n('toggleOff')}" aria-hidden="true"></span>
										</button>
									</div>
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

export const moduleSelectorTemplate = (categories: Array<{ name: string, translatedName: string, modules: Array<{ isEnabled: boolean, moduleID: string, translatedName: string, description: string, shortDescription: string }> }>) => string.html`
	<ul>
		${categories.map(({ name, translatedName, modules }) => string._html`
			<li class="RESConfigPanelCategory" data-category="${name}">
				<h3>
					<button type="button" class="categoryButton" aria-expanded="false">
						<span class="categoryButtonLabel">${translatedName}</span>
						<span class="categoryCount">${modules.length}</span>
					</button>
				</h3>
				<ul>
					${modules.map(({ isEnabled, moduleID, translatedName, description, shortDescription }) => string._html`
						<li>
							<button type="button" class="moduleButton ${isEnabled && 'enabled'}" data-module="${moduleID}" title="${description}">
								<span class="moduleButtonHeader">
									<span class="moduleButtonTitle">${translatedName}</span>
									<span class="moduleButtonStatusCluster">
										<span class="moduleButtonStage" hidden aria-hidden="true"></span>
										<span class="moduleButtonStatus" aria-hidden="true"></span>
									</span>
								</span>
								<small>
									${shortDescription}
								</small>
							</button>
						</li>
					`)}
				</ul>
			</li>
		`)}
	</ul>
`;
