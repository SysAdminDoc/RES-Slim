/* @flow */

import { once, uniqBy } from '../utils/functional';
import { Module } from '../core/module';
import * as Metadata from '../core/metadata';
import { Storage } from '../environment';
import * as Modules from '../core/modules';
import { greetingText, shouldGreet, shouldAnnounceUpdate, updateText } from '../utils/firstRun';
import type { PendingUpdate } from '../utils/firstRun';
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
	greetOrAnnounce();
};

// One notice at a time. The two are mutually exclusive by construction — a
// profile is either installing or updating, never both — but a leftover flag
// from an interrupted run should not stack two toasts on one page load.
async function greetOrAnnounce() {
	if (await greetOnFirstRun()) return;
	await announceUpdate();
}

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
	// A per-session nonce, not the extension ID. This element sits in reddit's own
	// DOM where reddit's own scripts can read it, and for an unpacked install
	// Chrome derives the ID from the install path — a stable per-machine
	// identifier, handed to the page, by a product that ships no telemetry
	// precisely so that it has nothing to hand over. The only consumer needs two
	// copies of the extension to look different from each other, which a nonce
	// does exactly as well.
	versionDiv.setAttribute('data-id', installNonce());
	document.body.appendChild(versionDiv);
}

// Distinct per page, per install. `crypto.randomUUID` is inside the browser
// floor; reached through `window` because Flow 0.84 has no declaration for the
// bare global. The fallback is only for a context that has none at all.
const installNonce = once((): string => {
	const webCrypto: any = (window: any).crypto;
	try {
		return `rsm-${webCrypto.randomUUID()}`;
	} catch (e) {
		return `rsm-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
	}
});

function avoidConcurrentInstalls() {
	const installs = Array.from(document.querySelectorAll('#RESConsoleVersion'));
	// versions before 5.6.2 will not report their id, so assume they are unique
	const concurrentInstalls = uniqBy(installs, e => e.getAttribute('data-id') || Math.random())
		// `data-fork-version` used to be published here too, which told the page the
		// exact build. The warning is about *how many* installs are running, so the
		// advisory version in textContent is all it needs.
		.map(e => e.textContent);

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

async function greetOnFirstRun(): Promise<boolean> {
	const pendingGreeting = await pendingGreetingStorage.get();
	if (!shouldGreet({ pendingGreeting })) return false;

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
	return true;
}

// --- update notice ---------------------------------------------------------
//
// Three mechanisms for telling a user something changed existed here and none
// of them reached anybody: `firstRun.js` returned early for reason `update`,
// `Metadata.updatedURL` was built and read by no shipped file, and
// `highestVersion` was written by a migration nothing consulted. Carrying three
// unread mechanisms is worse than carrying none, so this wires one up and the
// other two are gone.
//
// `updatedURL` used to be `CHANGELOG.md#v${version}`, which is neither absolute
// nor a real anchor — GitHub slugifies `## v0.46.0 - 2026-08-19` to
// `#v0460---2026-08-19`, so the link it described would have 404'd to the top of
// a 3,000-line file. It points at the release tag now, which the release script
// creates and which carries the same notes.
const PENDING_UPDATE_KEY = 'RESmodules.version.pendingUpdate';
const pendingUpdateStorage = Storage.wrap(PENDING_UPDATE_KEY, (null: PendingUpdate | null));

async function announceUpdate(): Promise<boolean> {
	const pending = await pendingUpdateStorage.get();
	if (!pending) return false;
	// Re-checked in the foreground rather than trusted: the flag persists, so a
	// profile that was updated while no reddit tab was open reads it later, and a
	// stale pair written by an older build should not be announced on its word.
	if (!shouldAnnounceUpdate(pending.previousVersion, pending.currentVersion)) {
		await pendingUpdateStorage.set(null);
		return false;
	}

	// Cleared before the toast, for the same reason the greeting is: `afterLoad`
	// runs in every tab, and two tabs opening together would otherwise both read
	// the flag and both announce.
	await pendingUpdateStorage.set(null);

	const message = document.createElement('div');
	message.append(updateText(pending.previousVersion, pending.currentVersion), ' ');
	message.append(string.html`<a href="${Metadata.updatedURL}" target="_blank" rel="noopener noreferrer">See what changed</a>`);

	showNotification({
		moduleID: 'version',
		notificationID: 'updated',
		header: 'RES-Slim',
		message,
		closeDelay: 30000,
		// A once-per-release notice does not need an "always show this notification
		// type" checkbox. Offering one invites turning off the only channel that
		// ever says anything.
		noDisable: true,
	});
	return true;
}
