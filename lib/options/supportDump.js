/* @flow */

// Gathers what `lib/utils/supportDump.js` formats.
//
// Nothing here runs until the user presses the button. That is the whole design
// constraint: the extension does not accumulate a diagnostics record in the
// background and does not persist one, so there is nothing to leak and nothing
// to forget to clear. Every value is read live from state the user can already
// see in this console, plus the module timings, which have to be fetched from
// the reddit page because that is the document they were measured in.

import * as Metadata from '../core/metadata';
import * as Modules from '../core/modules';
import { getModuleErrorLog } from '../core/modules/storage';
import { readSelectorDrift } from '../core/dom/selectorDiagnostics';
import { getOptionsURL } from '../environment/foreground/id';
import { browser, version as browserVersion, OS } from '../utils/browserDetect';
import { isTrustedConsoleOrigin } from '../utils/trustedOrigin';
import {
	collectDeviations,
	formatSupportDump,
	sanitizePageDiagnostics,
} from '../utils/supportDump';
import type { PageDiagnostics } from '../utils/supportDump';

// The reply crosses a process boundary and the page may be mid-navigation, so
// this cannot be unbounded. Missing timings degrade the dump by one section;
// a hung button degrades the whole panel.
export const DIAGNOSTICS_TIMEOUT_MS = 2000;

export function requestPageDiagnostics(timeout: number = DIAGNOSTICS_TIMEOUT_MS): Promise<?PageDiagnostics> {
	// Opened as its own tab rather than embedded in a reddit page: there is no
	// content script to ask, and saying so beats waiting two seconds to find out.
	if (window === window.parent) return Promise.resolve(null);

	return new Promise(resolve => {
		let optionsOrigin = null;
		try {
			optionsOrigin = getOptionsURL().origin;
		} catch (e) {
			// Outside an extension context. The reddit-origin check still applies.
		}

		const done = (value: ?PageDiagnostics) => {
			window.removeEventListener('message', onMessage);
			clearTimeout(timer);
			resolve(value);
		};

		function onMessage(event: MessageEvent) {
			if (!isTrustedConsoleOrigin(event.origin, optionsOrigin)) return;
			const diagnostics = sanitizePageDiagnostics(event.data);
			// Several message shapes reach this window. An unrecognised one is not
			// an answer, so keep listening rather than resolving on the first
			// message from anyone.
			if (!diagnostics) return;
			done(diagnostics);
		}

		const timer = setTimeout(() => done(null), timeout);

		window.addEventListener('message', onMessage);
		window.parent.postMessage({ requestDiagnostics: true }, '*');
	});
}

function moduleStates() {
	return Modules.all().map(module => ({
		moduleID: module.moduleID,
		enabled: Modules.isEnabled(module),
		// `_loadModulePrefs` uses exactly this expression when nothing is stored,
		// and `alwaysEnabled` modules can never deviate.
		defaultEnabled: module.alwaysEnabled || !module.disabledByDefault,
		options: module.options,
	}));
}

export async function buildSupportDump(now: number = Date.now()): Promise<string> {
	const [diagnostics, errors, drift] = await Promise.all([
		requestPageDiagnostics(),
		getModuleErrorLog().catch(() => []),
		readSelectorDrift().catch(() => ({})),
	]);

	return formatSupportDump({
		version: Metadata.version,
		browser,
		browserVersion: String(browserVersion),
		os: OS,
		renderer: diagnostics ? diagnostics.renderer : null,
		pageType: diagnostics ? diagnostics.pageType : null,
		generatedAt: now,
		timings: diagnostics ? diagnostics.timings : null,
		deviations: collectDeviations(moduleStates()),
		errors,
		drift,
	});
}
