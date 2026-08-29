/* @flow */
// The per-account run lease for `commentShredder`, decision logic and all.
//
// Why a lease at all: shredding is the one irreversible operation in this
// extension, and a tab-local boolean does not stop a second tab. Two runs over
// the same account always overlap in the way that matters — they share reddit's
// per-account write limiter, and the second tries to delete comments the first
// already deleted, turning a normal outcome into a page of failures the summary
// reports as untouched.
//
// Why not Web Locks: old Reddit and current Reddit are different origins, so
// their lock managers never see each other. The extension background is the only
// context both tabs share, which is where `applyLeaseOperation` runs.
//
// The decision logic lives here rather than in the background module so it can
// be tested against a plain Map, with no `chrome` and no messaging to stub. The
// background file is the adapter: it owns the Map, the clock and the token
// source, and nothing else.

import { normalizeUsername } from './userTags';

// Long enough that a slow renewal does not drop a live run, short enough that a
// tab killed mid-run frees the account within one panel's worth of patience.
export const SHRED_LEASE_TTL_MS = 15000;
export const SHRED_LEASE_HEARTBEAT_MS = 5000;

export type ShredLeaseRecord = {|
	token: string,
	tabId: number | null,
	account: string,
	startedAt: number,
	renewedAt: number,
	state: string,
|};

export type ShredLeaseOwner = {| sameTab: boolean, state: string, runningForMs: number |};

export function normalizeAccount(input: mixed): string {
	// The same normalization user tags key on: reddit usernames are
	// case-insensitive, and two tabs can spell the same account differently.
	return normalizeUsername(input);
}

export function leaseExpired(record: ?ShredLeaseRecord, now: number, ttl: number = SHRED_LEASE_TTL_MS): boolean {
	if (!record || typeof record.renewedAt !== 'number') return true;
	// `renewedAt` is always stamped from the store's own clock, so a record can
	// only read as being from the future if that clock moved backwards between a
	// renewal and this read. A negative age is under any ttl, which keeps the
	// live run's lease rather than expiring it early — the safe direction, since
	// expiring early is what lets a second tab start deleting underneath it.
	return now - record.renewedAt >= ttl;
}

// What a refused tab is told. Deliberately not the whole record: the token is
// the capability that lets a holder renew and release, so it never leaves the
// background.
export function describeOwner(record: ShredLeaseRecord, now: number, sameTab: boolean): ShredLeaseOwner {
	return {
		sameTab,
		state: record.state,
		runningForMs: Math.max(0, now - record.startedAt),
	};
}

export function ownerMessage(owner: ?ShredLeaseOwner): string {
	if (!owner) return 'A shred run for this account is already going. Wait for it to finish before starting a second one.';
	const minutes = Math.floor(owner.runningForMs / 60000);
	const seconds = Math.floor((owner.runningForMs % 60000) / 1000);
	const elapsed = minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
	const where = owner.sameTab ? 'this tab' : 'another tab';
	return `A shred run for this account is already going in ${where} (${owner.state}, ${elapsed} so far). Wait for it to finish before starting a second one.`;
}

// Reads through the expiry, so an abandoned lease is never reported as held and
// the caller never has to sweep.
export function heldLease(leases: Map<string, ShredLeaseRecord>, account: string, now: number): ?ShredLeaseRecord {
	const record = leases.get(account);
	if (!record) return null;
	if (leaseExpired(record, now)) {
		leases.delete(account);
		return null;
	}
	return record;
}

// One operation against the store. `makeToken` is injected so a test can assert
// which token came back without reaching for a crypto stub.
export function applyLeaseOperation(
	leases: Map<string, ShredLeaseRecord>,
	request: {| operation: string, account: mixed, token?: ?string, state?: ?string, tabId?: number | null |},
	now: number,
	makeToken: () => string,
): { [string]: any } {
	const { operation, token, state } = request;
	const tabId = typeof request.tabId === 'number' ? request.tabId : null;
	const account = normalizeAccount(request.account);
	// No account means no lease. Refusing rather than falling back to a shared key
	// stops two different accounts from blocking each other.
	if (!account) return { ok: false, reason: 'no-account' };

	const held = heldLease(leases, account, now);
	const owner = () => (held ? describeOwner(held, now, held.tabId !== null && held.tabId === tabId) : null);

	switch (operation) {
		case 'inspect':
			return { ok: !held, owner: owner() };

		case 'acquire': {
			// A holder re-acquiring is a renewal. That is what makes a service-worker
			// restart recoverable: the store is gone, the owner's next call rebuilds
			// the record it still believes it holds, and a second tab that got in
			// first keeps the account.
			if (held && held.token !== token) return { ok: false, owner: owner() };
			const record = {
				// A caller presenting a token keeps it, including when nothing is held.
				// That is the worker-restart case: minting a fresh token there would
				// leave the live owner releasing and renewing with one the store no
				// longer recognises, so its run would hold the account until the TTL.
				// Honouring the token grants nothing extra — an unheld account is
				// available to that caller either way.
				token: typeof token === 'string' && token ? token : makeToken(),
				tabId,
				account,
				startedAt: held ? held.startedAt : now,
				renewedAt: now,
				state: typeof state === 'string' && state ? state : 'running',
			};
			leases.set(account, record);
			return { ok: true, token: record.token };
		}

		case 'renew': {
			// A lost lease cannot be renewed back into existence: the account belongs
			// to somebody else now, and the caller has to stop rather than race.
			if (!held || held.token !== token) return { ok: false, owner: owner() };
			held.renewedAt = now;
			held.tabId = tabId;
			if (typeof state === 'string' && state) held.state = state;
			return { ok: true, token: held.token };
		}

		case 'release':
			// Releasing a lease somebody else now holds must not take theirs, so the
			// token has to match. Reporting success either way keeps a late release
			// from a finished run out of the caller's error path.
			if (held && held.token === token) leases.delete(account);
			return { ok: true };

		default:
			throw new Error(`Invalid shredLease operation: ${String(operation)}`);
	}
}

// A closed tab is unambiguous, where the TTL is only a backstop.
export function releaseLeasesForTab(leases: Map<string, ShredLeaseRecord>, tabId: number): number {
	let released = 0;
	for (const [account, record] of leases) {
		if (record.tabId === tabId) {
			leases.delete(account);
			released += 1;
		}
	}
	return released;
}
