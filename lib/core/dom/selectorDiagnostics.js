/* @flow */

import * as Storage from '../../environment/foreground/storage';
import { makeModuleErrorEntry } from '../../utils/moduleErrorLog';
import {
	DRIFT_STORAGE_KEY,
	mergeDrift,
	normalizeDriftState,
	toFindings,
} from '../../utils/selectorDrift';
import type { DriftState } from '../../utils/selectorDrift';
import { recordModuleErrorOnce } from '../modules/storage';
import {
	formatSelectorDriftMessage,
	selectorDriftForPage,
} from './selectors';

// One id per renderer, so `recordModuleErrorOnce` dedupes drift on old Reddit
// separately from drift on current Reddit rather than letting the first one seen
// suppress the other.
const MODULE_IDS = { r2: 'oldRedditSelectors', d2x: 'currentRedditSelectors' };

const driftStorage = Storage.wrap(DRIFT_STORAGE_KEY, ({}: DriftState));

export async function readSelectorDrift(): Promise<DriftState> {
	try {
		return normalizeDriftState(await driftStorage.get());
	} catch (e) {
		// Diagnostics must never be the thing that breaks a page. An unreadable
		// store means "nothing known", not "stop".
		return {};
	}
}

export async function clearSelectorDrift(): Promise<void> {
	try {
		await driftStorage.set({});
	} catch (e) {
		// nothing to do — the next page load will re-record whatever is still drifting
	}
}

// Both records are written from here, from one set of findings, so the
// structured view and the error log cannot disagree about what drifted. They
// answer different questions: the log is "what went wrong on this machine, in
// order", the drift state is "which surfaces are on fallbacks right now, and
// since when" — the second is what the settings console renders, and rendering
// it out of the first would mean parsing prose back into structure.
export async function recordSelectorDiagnostics(pageType: ?string, root: Document | HTMLElement = document, now: number = Date.now(), appType: string = 'r2'): Promise<boolean> {
	if (!pageType) return false;
	const matches = selectorDriftForPage(pageType, root, appType);
	if (!matches.length) return false;

	await recordModuleErrorOnce(makeModuleErrorEntry(
		MODULE_IDS[appType] || MODULE_IDS.r2,
		`selector-drift:${appType}:${pageType}`,
		formatSelectorDriftMessage(pageType, matches, appType),
	));

	try {
		const state = await readSelectorDrift();
		// Keyed by renderer as well as page type: a `comments` page exists on both,
		// and one overwriting the other would hide whichever was seen first.
		await driftStorage.set(mergeDrift(state, `${appType}:${pageType}`, toFindings(matches), now));
	} catch (e) {
		// The error-log entry above already landed, so the drift is not lost.
	}
	return true;
}
