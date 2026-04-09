/* @flow */

import { RES_SETTINGS_HASH } from '../constants/urlHashes';
import { i18n } from '../environment';
import { string } from '../utils';

export const consoleContainerTemplate = ({ name, version, showAllOptions }: {| name: string, version: string, showAllOptions: boolean |}) => string.html`
	<div id="RESConsoleContainer" class="${showAllOptions ? 'advanced-options-enabled' : ''}">
		<div id="RESConsoleHeader">
			<div id="RESConsoleTopBar" class="RESDialogTopBar">
				<a class="res-logo" href="${RES_SETTINGS_HASH}" aria-label="${name} settings home"></a>
				<h1>${name}</h1>
				<div id="RESConsoleVersionDisplay" translate="no">v${version}</div>


				<button id="moduleOptionsSave" type="button">${i18n('saveOptions')}</button>
				<div id="moduleOptionsSaveStatus" class="saveStatus" role="status" aria-live="polite" hidden>Settings saved.</div>
				<a id="RESConsoleSubredditLink" href="/r/Enhancement" alt="The RES Subreddit">/r/Enhancement</a>
				<button id="RESClose" type="button" aria-label="Close settings" class="RESCloseButton RESCloseButtonTopRight"></button>
			</div>
		</div>

		<div id="RESConsoleContent">
			<aside id="RESConfigPanelModulesPane" aria-label="Settings modules">
				<div id="SearchRES-input-container"></div>

				<div id="RESConfigPanelModulesList"></div>

				<label id="RESAllOptionsSpan">
					<input id="RESAllOptions" type="checkbox" ${showAllOptions ? 'checked' : ''}>
					<span>${i18n('showAdvancedOptions')}</span>
				</label>
			</aside>
			<main id="RESConfigPanelOptions">
				<header class="moduleHeader">
					<h2 class="moduleName">Module Name</h2>
					<button type="button" class="moduleToggle toggleButton enabled" data-module="moduleID" aria-pressed="true" aria-label="Disable module">
						<span class="toggleThumb" aria-hidden="true"></span>
						<span class="toggleLabel" data-enabled-text="${i18n('toggleOn')}" data-disabled-text="${i18n('toggleOff')}" aria-hidden="true"></span>
					</button>

					<div class="moduleDescription"></div>
				</header>
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
					<button type="button" class="categoryButton" aria-expanded="false">${translatedName}</button>
				</h3>
				<ul>
					${modules.map(({ isEnabled, moduleID, translatedName, description, shortDescription }) => string._html`
						<li>
							<button type="button" class="moduleButton ${isEnabled && 'enabled'}" data-module="${moduleID}" title="${description}">
								${translatedName}
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
