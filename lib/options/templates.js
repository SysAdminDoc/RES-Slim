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
						<div class="consoleEyebrow">Settings Workspace</div>
						<div class="consoleTitleRow">
							<h1>${name}</h1>
							<div id="RESConsoleVersionDisplay" translate="no">v${version}</div>
						</div>
						<p class="consoleSubtitle">Tune modules, search the full settings library, and stage changes before you save.</p>
					</div>
				</div>

				<div class="consoleHeaderActions">
					<a id="RESConsoleSubredditLink" href="/r/Enhancement" alt="The RES Subreddit">/r/Enhancement</a>
					<div id="moduleOptionsSaveStatus" class="saveStatus" role="status" aria-live="polite" hidden>Settings saved.</div>
					<button id="moduleOptionsSave" type="button">${i18n('saveOptions')}</button>
					<button id="RESClose" type="button" aria-label="Close settings" class="RESCloseButton RESCloseButtonTopRight"></button>
				</div>
			</div>
		</div>

		<div id="RESConsoleContent">
			<aside id="RESConfigPanelModulesPane" aria-label="Settings modules">
				<div class="sidebarSection sidebarTools">
					<div class="sidebarSectionHeader">
						<span class="sidebarSectionEyebrow">Explore</span>
						<span class="sidebarSectionHint">Search or browse</span>
					</div>
					<label class="sidebarSearchLabel" for="SearchRES-input">Find a Setting</label>
					<div id="SearchRES-input-container"></div>
					<p class="sidebarSearchHint">Search by module name, option name, or description.</p>
				</div>

				<div class="sidebarSection sidebarModules">
					<div class="sidebarSectionHeader">
						<span class="sidebarSectionTitle">Modules</span>
						<span id="RESModuleCountBadge" class="sidebarCountBadge"></span>
					</div>
					<div id="RESConfigPanelModulesList"></div>
				</div>

				<label id="RESAllOptionsSpan" class="sidebarSection advancedOptionsPanel">
					<span class="advancedOptionsCopy">
						<strong>${i18n('showAdvancedOptions')}</strong>
						<small>Reveal expert-level settings and hidden search results.</small>
					</span>
					<input id="RESAllOptions" type="checkbox" ${showAllOptions ? 'checked' : ''}>
				</label>
			</aside>
			<main id="RESConfigPanelOptions">
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
						<button type="button" class="moduleToggle toggleButton enabled" data-module="moduleID" aria-pressed="true" aria-label="Disable module">
							<span class="toggleThumb" aria-hidden="true"></span>
							<span class="toggleLabel" data-enabled-text="${i18n('toggleOn')}" data-disabled-text="${i18n('toggleOff')}" aria-hidden="true"></span>
						</button>
					</div>
				</header>
				<div class="moduleDescription"></div>
				<div id="allOptionsContainer"></div>
				<div id="noOptions" class="optionContainer" role="status">
					There are no configurable options for this module.
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
									<span class="moduleButtonStatus" aria-hidden="true"></span>
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
