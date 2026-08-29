import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

// `userTags` supplies the username normalization the lease keys on; reusing it
// is the point, so it is loaded rather than duplicated.
const lease = await loadFlowModule('lib/utils/shredLease.js', 'shred-lease', { deps: ['lib/utils/userTags.js'] });
const {
	SHRED_LEASE_HEARTBEAT_MS,
	SHRED_LEASE_TTL_MS,
	applyLeaseOperation,
	leaseExpired,
	normalizeAccount,
	ownerMessage,
	releaseLeasesForTab,
} = lease;

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

// A deterministic token source, so a test can name the token it expects instead
// of reaching for a crypto stub.
function tokens(prefix = 'token') {
	let n = 0;
	return () => `${prefix}-${++n}`;
}

function store() {
	return new Map();
}

function acquire(leases, account, at, { token = null, tabId = 1, state } = {}, makeToken = tokens()) {
	return applyLeaseOperation(leases, { operation: 'acquire', account, token, state, tabId }, at, makeToken);
}

test('the heartbeat renews well inside the expiry it is defending', () => {
	// If these ever cross, a live run loses its own lease and a second tab can
	// start deleting underneath it. Three heartbeats of headroom.
	assert.ok(SHRED_LEASE_HEARTBEAT_MS * 3 <= SHRED_LEASE_TTL_MS, `${SHRED_LEASE_HEARTBEAT_MS} * 3 must fit inside ${SHRED_LEASE_TTL_MS}`);
});

test('the lease is keyed by the account, not by how a tab spelled it', () => {
	assert.equal(normalizeAccount('  SysAdminDoc '), 'sysadmindoc');
	assert.equal(normalizeAccount('sysadmindoc'), 'sysadmindoc');
	assert.equal(normalizeAccount(null), '');

	const leases = store();
	assert.equal(acquire(leases, 'SysAdminDoc', NOW).ok, true);
	// The same account reached from the other renderer, typed the other way.
	const second = acquire(leases, 'sysadmindoc', NOW + 1000, { tabId: 2 });
	assert.equal(second.ok, false, 'case must not open a second run on one account');
	assert.equal(second.owner.sameTab, false);
});

test('a different account is not blocked by a run on another', () => {
	const leases = store();
	assert.equal(acquire(leases, 'alice', NOW).ok, true);
	assert.equal(acquire(leases, 'bob', NOW, { tabId: 2 }).ok, true);
	assert.equal(leases.size, 2);
});

test('no account means no lease, rather than one shared key', () => {
	const leases = store();
	const result = acquire(leases, '   ', NOW);
	assert.deepEqual(result, { ok: false, reason: 'no-account' });
	assert.equal(leases.size, 0, 'a nameless request must not occupy a slot every other account then collides with');
});

test('the refused tab learns the state and age of the run, but never its token', () => {
	const leases = store();
	const granted = acquire(leases, 'alice', NOW, { tabId: 1, state: 'running' }, tokens());
	// A run that has been going for 65 seconds has been heartbeating for 65
	// seconds. One renewal at the end does not model that — the lease would have
	// expired long before it arrived — so the heartbeat is played out.
	const beats = Array.from({ length: 60000 / SHRED_LEASE_HEARTBEAT_MS }, (_, i) => NOW + (i + 1) * SHRED_LEASE_HEARTBEAT_MS);
	for (const at of beats) {
		const beat = applyLeaseOperation(leases, { operation: 'renew', account: 'alice', token: granted.token, tabId: 1 }, at, tokens());
		assert.equal(beat.ok, true, `the heartbeat must hold the lease at +${at - NOW}ms`);
	}

	const refused = acquire(leases, 'alice', NOW + 65000, { tabId: 2 });
	assert.equal(refused.ok, false);
	assert.equal(refused.token, undefined, 'the token is the capability to release somebody else\'s run');
	assert.deepEqual(refused.owner, { sameTab: false, state: 'running', runningForMs: 65000 });
	assert.match(ownerMessage(refused.owner), /another tab/);
	assert.match(ownerMessage(refused.owner), /1m 5s/);

	// The same tab asking again is told so, because "wait for the other tab" is
	// wrong and unactionable when there is no other tab.
	const sameTab = applyLeaseOperation(leases, { operation: 'inspect', account: 'alice', tabId: 1 }, NOW + 1000, tokens());
	assert.equal(sameTab.owner.sameTab, true);
	assert.match(ownerMessage(sameTab.owner), /this tab/);
});

test('only the holder can renew, and renewing is what keeps the run alive', () => {
	const leases = store();
	const granted = acquire(leases, 'alice', NOW, {}, tokens());
	assert.equal(granted.ok, true);

	const renewed = applyLeaseOperation(leases, { operation: 'renew', account: 'alice', token: granted.token, state: 'stopping', tabId: 1 }, NOW + 5000, tokens());
	assert.equal(renewed.ok, true);

	// Past the original expiry, but renewals moved it.
	assert.equal(applyLeaseOperation(leases, { operation: 'inspect', account: 'alice', tabId: 2 }, NOW + 18000, tokens()).ok, false);
	assert.equal(applyLeaseOperation(leases, { operation: 'inspect', account: 'alice', tabId: 2 }, NOW + 18000, tokens()).owner.state, 'stopping');

	const impostor = applyLeaseOperation(leases, { operation: 'renew', account: 'alice', token: 'not-the-token', tabId: 2 }, NOW + 6000, tokens());
	assert.equal(impostor.ok, false, 'a lost lease must not be renewable back into existence');
	assert.equal(impostor.owner.sameTab, false);
});

test('a lease that stops being renewed expires, and a clock that jumps back does not extend it', () => {
	const leases = store();
	acquire(leases, 'alice', NOW, {}, tokens());

	assert.equal(leaseExpired(leases.get('alice'), NOW + SHRED_LEASE_TTL_MS - 1), false);
	assert.equal(leaseExpired(leases.get('alice'), NOW + SHRED_LEASE_TTL_MS), true);

	// A clock that moved backwards between a renewal and this read makes the
	// record look like it came from the future. That must keep the live run's
	// lease, not expire it early: expiring early is what lets a second tab start
	// deleting underneath the first.
	leases.set('alice', { ...leases.get('alice'), renewedAt: NOW + 3600000 });
	assert.equal(leaseExpired(leases.get('alice'), NOW + SHRED_LEASE_TTL_MS), false);

	// And an expired record is swept on read rather than answered from.
	const leases2 = store();
	acquire(leases2, 'alice', NOW, { tabId: 1 }, tokens());
	const takeover = acquire(leases2, 'alice', NOW + SHRED_LEASE_TTL_MS, { tabId: 2 }, tokens('second'));
	assert.equal(takeover.ok, true, 'an abandoned account must become available again');
	assert.equal(takeover.token, 'second-1');
	assert.equal(leases2.size, 1);
});

test('releasing takes only your own lease', () => {
	const leases = store();
	const granted = acquire(leases, 'alice', NOW, {}, tokens());

	const wrong = applyLeaseOperation(leases, { operation: 'release', account: 'alice', token: 'someone-elses', tabId: 2 }, NOW + 1000, tokens());
	assert.equal(wrong.ok, true, 'a late release from a finished run is not an error');
	assert.equal(leases.size, 1, 'but it must not take the lease that is actually held');

	applyLeaseOperation(leases, { operation: 'release', account: 'alice', token: granted.token, tabId: 1 }, NOW + 2000, tokens());
	assert.equal(leases.size, 0);
	assert.equal(acquire(leases, 'alice', NOW + 3000, { tabId: 2 }).ok, true);
});

test('a closed tab frees the accounts it was holding, and nobody else\'s', () => {
	const leases = store();
	acquire(leases, 'alice', NOW, { tabId: 7 }, tokens());
	acquire(leases, 'bob', NOW, { tabId: 9 }, tokens());

	assert.equal(releaseLeasesForTab(leases, 7), 1);
	assert.equal(leases.has('alice'), false);
	assert.equal(leases.has('bob'), true);
	assert.equal(releaseLeasesForTab(leases, 7), 0, 'closing a tab twice is not an error');
});

test('a service worker restart releases rather than strands, and the holder re-asserts', () => {
	// The store is in memory, so a restart is an empty Map. That is a release: a
	// restarted worker cannot itself be mid-run, and the alternative — a lease
	// nothing can clear — strands the account until the browser closes.
	const leases = store();
	const granted = acquire(leases, 'alice', NOW, { tabId: 1 }, tokens());

	const restarted = store();
	assert.equal(applyLeaseOperation(restarted, { operation: 'inspect', account: 'alice', tabId: 2 }, NOW + 1000, tokens()).ok, true);

	// The live owner's next heartbeat rebuilds the record it still believes it
	// holds, keeping its own token so its later release still matches.
	const reasserted = acquire(restarted, 'alice', NOW + 5000, { token: granted.token, tabId: 1 }, tokens('fresh'));
	assert.equal(reasserted.ok, true);
	assert.equal(reasserted.token, granted.token, 'the holder keeps its token, so its release is still recognised');
	assert.equal(applyLeaseOperation(restarted, { operation: 'inspect', account: 'alice', tabId: 2 }, NOW + 5001, tokens()).ok, false);
});

test('an unknown operation is a programming error, not a silent grant', () => {
	const leases = store();
	assert.throws(
		() => applyLeaseOperation(leases, { operation: 'take', account: 'alice', tabId: 1 }, NOW, tokens()),
		/Invalid shredLease operation/,
	);
});

test('the background adapter owns the store and the clock, and delegates every decision', () => {
	const source = readRepoFile('lib/environment/background/shredLease.js');
	assert.match(source, /applyLeaseOperation\(/, 'the decision must not be re-implemented in the adapter');
	assert.match(source, /chrome\.tabs\.onRemoved/, 'a closed tab must free its accounts');
	assert.match(source, /releaseLeasesForTab/);
	// The listener has to be registered for a content script to reach it at all.
	assert.match(source, /addListener\('shredLease'/);

	const entry = readRepoFile('lib/background.entry.js');
	assert.match(entry, /environment\/background\/shredLease/, 'an unimported listener is a lease nobody can take');
});

test('the destructive path takes the lease, heartbeats it, and hands it back', () => {
	const mod = readRepoFile('lib/modules/commentShredder.js');
	assert.match(mod, /accountLease\(me\)/, 'the lease has to be keyed by the account being shredded');
	assert.match(mod, /await lease\.acquire\(\)/, 'the run must not start before the account is held');
	assert.match(mod, /setInterval\(/, 'without a heartbeat a long run expires under itself');
	assert.match(mod, /SHRED_LEASE_HEARTBEAT_MS/);
	assert.match(mod, /lease\.release\(\)/);
	// `once: true` would make a refusal permanent for that panel.
	assert.ok(!/\}, \{ once: true \}\);/.test(mod), 'a refused run has to stay retryable');
});
