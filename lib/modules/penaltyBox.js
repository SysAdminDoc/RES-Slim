/* @flow */
// RES-Slim: skip media hosts that are repeatedly failing, and let them back in
// on their own.
//
// `showImages` tries every handler that claims a link's hostname, and
// `linkScanner`'s catch logs, destroys the expando and moves on — with no memory
// that it just did the same for the previous twenty links. When a host is down,
// that is one dead network round-trip per link, on every page, indefinitely.
//
// This is not the upstream module of the same name. Upstream's penalty box
// lengthens hover-menu delays and turns off the daily-tip feature for users who
// keep dismissing it; its three callers are modules this fork does not ship. The
// name is kept because it is the right name for the mechanism.
//
// The policy itself lives in `lib/utils/penaltyBox.js` as pure functions over a
// plain record. This file owns only the parts that cannot be pure: reading the
// clock, persisting, and reporting.

import { Module } from '../core/module';
import { Storage } from '../environment';
import { makeModuleErrorEntry } from '../utils/moduleErrorLog';
import { recordModuleErrorOnce } from '../core/modules/storage';
import {
	DEFAULT_THRESHOLD,
	MAX_BACKOFF_MS,
	formatSuspensionMessage,
	isSuspended as stateIsSuspended,
	normalizePenaltyState,
	prunePenaltyState,
	recordFailure as stateRecordFailure,
	recordSuccess as stateRecordSuccess,
	suspendedHosts as stateSuspendedHosts,
	suspendedUntil as stateSuspendedUntil,
} from '../utils/penaltyBox';
import type { PenaltyState, SuspendedHost } from '../utils/penaltyBox';

export const module: Module<{ [string]: any }> = new Module('penaltyBox');

module.moduleName = 'Media host penalty box';
module.category = 'coreCategory';
module.description = 'Stops retrying media hosts that keep failing. After a few failures in a row a host is skipped for a while, doubling each time it fails again, and it is let back in automatically once the wait is over. Suspensions are recorded in the diagnostics log.';
module.descriptionRaw = true;
module.keywords = ['media', 'host', 'failure', 'backoff', 'reliability', 'expando'];
// Scoped to match `showImages`, which is the only caller. Left unscoped it would
// warm its cache on the submit page and the subreddit directory, where there are
// no expandos to protect — and it would show up in the module registry's list of
// globally-scoped modules, which exists so that list stays short enough to read.
module.exclude = [
	/^\/ads\/[\-\w\._\?=]*/i,
	'submit',
	/^\/subreddits/i,
];

module.options = {
	threshold: {
		type: 'text',
		value: String(DEFAULT_THRESHOLD),
		title: 'Failures before a host is skipped',
		description: 'How many times a host may fail within five minutes before RES-Slim stops trying it for a while.',
	},
	logSuspensions: {
		type: 'boolean',
		value: true,
		title: 'Record suspensions in the diagnostics log',
		description: 'Adds an entry to the module diagnostics log whenever a host is put in the penalty box, so a host that has quietly stopped working is visible rather than only slow.',
	},
};

const STORAGE_KEY = 'RES.penaltyBox.hosts';
const storage = Storage.wrapFeature('penaltyBox', STORAGE_KEY, ({}: PenaltyState));

// One in-memory copy per page. Every read goes through storage first so two tabs
// converge, but the scan path must not await a storage round-trip per link — a
// hot listing calls `isHostSuspended` dozens of times in a burst.
let cached: ?PenaltyState = null;
let loading: ?Promise<PenaltyState> = null;

function options() {
	return {
		threshold: parseInt(String(module.options.threshold.value || DEFAULT_THRESHOLD), 10) || DEFAULT_THRESHOLD,
	};
}

export function loadState(now: number = Date.now()): Promise<PenaltyState> {
	if (cached) return Promise.resolve(cached);
	if (!loading) {
		loading = (async () => {
			let stored = {};
			try {
				stored = normalizePenaltyState(await storage.get());
			} catch (e) {
				// A corrupt or unreadable store must not take the expandos with it:
				// the whole point of this module is to make failures cheaper.
				stored = {};
			}
			cached = prunePenaltyState(stored, now, options());
			return cached;
		})();
	}
	return loading;
}

async function commit(next: PenaltyState, now: number): Promise<void> {
	cached = prunePenaltyState(next, now, options());
	try {
		await storage.set(cached);
	} catch (e) {
		// Keep the in-memory decision. A page that cannot persist still benefits
		// from not retrying the same dead host twenty more times.
	}
}

// Synchronous by design. `linkScanner` asks this once per candidate handler
// inside a loop that already awaits per link; making the question async would
// add a microtask hop to every link on the page for an answer that is almost
// always "no".
export function isHostSuspended(host: string, now: number = Date.now()): boolean {
	if (!cached) return false;
	return stateIsSuspended(cached, host, now);
}

export function suspendedUntilFor(host: string): number {
	return cached ? stateSuspendedUntil(cached, host) : 0;
}

export function listSuspended(now: number = Date.now()): SuspendedHost[] {
	return cached ? stateSuspendedHosts(cached, now) : [];
}

export async function noteFailure(host: string, now: number = Date.now()): Promise<boolean> {
	if (!host) return false;
	const state = await loadState(now);
	const result = stateRecordFailure(state, host, now, options());
	await commit(result.state, now);

	if (result.suspended && module.options.logSuspensions.value !== false) {
		try {
			// A host that recovers and fails again gets a fresh entry — its backoff
			// and strike number differ — while every link that hit the same outage
			// gets one, because `recordFailure` refuses to re-suspend a host that is
			// already suspended.
			await recordModuleErrorOnce(makeModuleErrorEntry(
				module.moduleID,
				`host-suspended:${host}`,
				formatSuspensionMessage(host, result.until, now, result.strikes),
				now,
			));
		} catch (e) {
			// Reporting the backoff must never cost the backoff. The log shares a
			// store with everything else, so it is the first thing to fail when the
			// quota is gone — exactly when a page is most likely to be misbehaving.
		}
	}
	return result.suspended;
}

export async function noteSuccess(host: string, now: number = Date.now()): Promise<void> {
	if (!host) return;
	if (cached && !cached[host]) return; // nothing recorded, nothing to clear
	const state = await loadState(now);
	if (!state[host]) return;
	await commit(stateRecordSuccess(state, host), now);
}

export async function pardonAll(): Promise<void> {
	cached = {};
	try {
		await storage.set({});
	} catch (e) {
		// in-memory clear still stands
	}
}

// Exposed for tests: module state that survives between page loads is exactly
// what makes a stale in-memory copy look like a passing assertion.
export function _resetForTests() {
	cached = null;
	loading = null;
}

export const MAX_SUSPENSION_MS: number = MAX_BACKOFF_MS;

module.beforeLoad = () => {
	// Warm the cache once, so the synchronous check has something to read by the
	// time the first link is scanned. Not awaited by callers: an unwarmed cache
	// answers "not suspended", which is the same behaviour the module replaced.
	loadState();
};
