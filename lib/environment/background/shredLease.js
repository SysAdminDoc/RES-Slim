/* @flow */
// The authority for `commentShredder`'s per-account run lease.
//
// This lives in the background because it is the only context old Reddit and
// current Reddit share. They are different origins, so `navigator.locks`,
// `localStorage` and `BroadcastChannel` all fail to see across them, and the
// module's previous guard was a tab-local boolean that saw nothing at all.
//
// The store is an in-memory Map on purpose. A service worker restart drops every
// lease, which is a release rather than a leak: the failure mode a lease guards
// against is two tabs deleting at once, and a restarted worker cannot be holding
// a run of its own. The live owner re-asserts on its next heartbeat.
//
// Every decision is in `applyLeaseOperation`. This file owns the Map, the clock
// and the token source, and nothing else.

import { applyLeaseOperation, releaseLeasesForTab } from '../../utils/shredLease';
import { addListener } from './messaging';

const leases: Map<string, any> = new Map();

function newToken(): string {
	if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	// Only reachable on an engine without `crypto.randomUUID`. The token is a
	// capability against this extension's own tabs, not a secret, so uniqueness is
	// the whole requirement.
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

addListener('shredLease', ({ operation, account, token, state }: any, { tab }: any) => applyLeaseOperation(
	leases,
	{ operation, account, token, state, tabId: tab && typeof tab.id === 'number' ? tab.id : null },
	Date.now(),
	newToken,
));

if (chrome.tabs && chrome.tabs.onRemoved) {
	chrome.tabs.onRemoved.addListener(tabId => { releaseLeasesForTab(leases, tabId); });
}
