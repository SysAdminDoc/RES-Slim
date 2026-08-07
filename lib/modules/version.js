/* @flow */

import { uniqBy } from '../utils/functional';
import { Module } from '../core/module';
import * as Metadata from '../core/metadata';
import { Storage, getExtensionId } from '../environment';
import * as Modules from '../core/modules';
import { greetingText, shouldGreet } from '../utils/firstRun';
import {
	BodyClasses,
	range,
	string,
} from '../utils';
import * as SettingsNavigation from './settingsNavigation';
import { showNotification } from './notifications';

export const module: Module<*> = new Module('version');

module.moduleName = 'versionName';
module.category = 'aboutCategory';
module.description = 'versionDesc';
module.alwaysEnabled = true;
module.hidden = true;

const concurrentInstallWiki = '/r/Enhancement/wiki/tutorials/concurrent_installs';
const redditAdvisoryVersion = 'v4.3.2.1';

module.beforeLoad = () => {
	addVersionClasses();
};

module.contentStart = () => {
	reportVersion();
};

module.afterLoad = () => {
	avoidConcurrentInstalls();
	greetOnFirstRun();
};

function addVersionClasses() {
	BodyClasses.add('res');
	const versionComponents = Metadata.version.split('.');
	for (const i of range(0, versionComponents.length)) {
		BodyClasses.add(`res-v${versionComponents.slice(0, i + 1).join('-')}`);
	}
}

function reportVersion() {
	// Old Reddit treats this beacon as an upstream RES version and blocks expandos
	// for anything older than 4.3.2.1. RES-Slim uses its own fork versioning, so
	// report the minimum safe compatibility version while preserving the fork
	// version separately for our own diagnostics.
	const versionDiv = document.createElement('div');
	versionDiv.id = 'RESConsoleVersion';
	versionDiv.style.display = 'none';
	versionDiv.textContent = redditAdvisoryVersion;
	versionDiv.setAttribute('data-id', getExtensionId());
	versionDiv.setAttribute('data-fork-version', Metadata.version);
	document.body.appendChild(versionDiv);
}

function avoidConcurrentInstalls() {
	const installs = Array.from(document.querySelectorAll('#RESConsoleVersion'));
	// versions before 5.6.2 will not report their id, so assume they are unique
	const concurrentInstalls = uniqBy(installs, e => e.getAttribute('data-id') || Math.random())
		.map(e => e.getAttribute('data-fork-version') || e.textContent);

	if (concurrentInstalls.length > 1) {
		BodyClasses.add('res-concurrent-installs');
		document.body.appendChild(string.html`
			<div id="res-concurrent-installs">
				<p>You have enabled multiple versions of Reddit Enhancement Suite:</p>
				<ul>
					${concurrentInstalls.map(v => string._html`
						<li>${v}</li>
					`)}
				</ul>
				<p>You should enable only one. <a href="${concurrentInstallWiki}">Find out how!</a>
			</div>
		`);
	}
}

// Written by the background on `chrome.runtime.onInstalled` with reason
// 'install', read and cleared here. The foreground is where a toast can be shown;
// the background is the only place that knows an install happened.
const PENDING_KEY = 'RESmodules.version.pendingGreeting';
const pendingGreetingStorage = Storage.wrap(PENDING_KEY, (false: boolean));

async function greetOnFirstRun() {
	const pendingGreeting = await pendingGreetingStorage.get();
	if (!shouldGreet({ pendingGreeting })) return;

	// Cleared before the toast, not after: `afterLoad` runs in every tab, and two
	// tabs opening together would otherwise both read the flag and both greet.
	await pendingGreetingStorage.set(false);

	const enabled = Modules.all().filter(m => !m.hidden && Modules.isEnabled(m)).length;

	const message = document.createElement('div');
	message.append(greetingText(enabled), ' ');
	// `makeUrlHashLink` returns markup, not text — every existing caller wraps it in
	// `string.safe()`, and interpolating it directly would escape the anchor into
	// visible angle brackets.
	message.append(string.html`${string.safe(SettingsNavigation.makeUrlHashLink('', undefined, 'Open settings'))}`);

	showNotification({
		moduleID: 'version',
		notificationID: 'first-run',
		header: 'RES-Slim',
		message,
		closeDelay: 30000,
	});
}
