/* @flow */

import * as Storage from '../../environment/foreground/storage';
import { storage } from './storage';

export const SNAPSHOT_APP = 'res-slim';
export const SNAPSHOT_FORMAT_VERSION = 1;
// The oldest layout this build still knows how to read. Only `1` has ever
// shipped, so today these are equal — the constant exists so that raising
// SNAPSHOT_FORMAT_VERSION forces a deliberate answer to "and can we still read
// the old one?" rather than leaving it implied.
export const MIN_SUPPORTED_FORMAT_VERSION = 1;

type ModuleOptionsBlob = { [optionKey: string]: { value: mixed } };

export type SettingsSnapshot = {|
	app: typeof SNAPSHOT_APP,
	appVersion: string,
	formatVersion: typeof SNAPSHOT_FORMAT_VERSION,
	exportedAt: string,
	modules: { [moduleID: string]: ModuleOptionsBlob },
|};

function isPlainObject(value: mixed): boolean %checks {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function buildSnapshot({ appVersion, now = new Date() }: {| appVersion: string, now?: Date |}): Promise<SettingsSnapshot> {
	const modules = await storage.getAll();
	const sanitized: { [string]: ModuleOptionsBlob } = {};
	for (const [moduleID, blob] of Object.entries(modules)) {
		if (!isPlainObject(blob)) continue;
		sanitized[moduleID] = (blob: any);
	}
	return {
		app: SNAPSHOT_APP,
		appVersion,
		formatVersion: SNAPSHOT_FORMAT_VERSION,
		exportedAt: now.toISOString(),
		modules: sanitized,
	};
}

export class InvalidSnapshotError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidSnapshotError';
	}
}

export function parseSnapshot(input: mixed): SettingsSnapshot {
	let payload: mixed = input;
	if (typeof input === 'string') {
		try {
			payload = JSON.parse(input);
		} catch (e) {
			throw new InvalidSnapshotError(`Settings file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	if (!isPlainObject(payload)) {
		throw new InvalidSnapshotError('Settings file root must be an object.');
	}
	const obj: { [string]: mixed } = (payload: any);
	if (obj.app !== SNAPSHOT_APP) {
		throw new InvalidSnapshotError(`Settings file app must be "${SNAPSHOT_APP}" (got "${String(obj.app)}").`);
	}
	const modules = obj.modules;
	if (!isPlainObject(modules)) {
		throw new InvalidSnapshotError('Settings file is missing a "modules" object.');
	}
	const sanitized: { [string]: ModuleOptionsBlob } = {};
	for (const [moduleID, blob] of Object.entries((modules: any))) {
		if (!isPlainObject(blob)) continue;
		sanitized[moduleID] = (blob: any);
	}
	// A file from a *newer* build is the one case where importing is worse than
	// refusing. `migrate.js` is a 937-line ladder that only runs forward, so a
	// layout this build has never seen cannot be interpreted — it can only be
	// written over the user's working configuration and hoped about. Export and
	// import are the only data-safety net in a product with no cloud backup, and
	// this is the one irreversible thing a settings page can do.
	//
	// Absent or non-numeric means "written before the field existed", which is
	// the current layout by definition. Present-but-wrong is refused rather than
	// coerced: a `formatVersion` of `"2"` or `NaN` is a corrupt file, and
	// silently reading it as 1 is the same mistake in a smaller font.
	const rawFormatVersion = obj.formatVersion;
	let formatVersion = SNAPSHOT_FORMAT_VERSION;
	if (rawFormatVersion !== undefined && rawFormatVersion !== null) {
		if (typeof rawFormatVersion !== 'number' || !Number.isFinite(rawFormatVersion) || !Number.isInteger(rawFormatVersion)) {
			throw new InvalidSnapshotError(`Settings file has an unreadable format version (${JSON.stringify(rawFormatVersion)}). Nothing was changed.`);
		}
		formatVersion = rawFormatVersion;
	}

	if (formatVersion > SNAPSHOT_FORMAT_VERSION) {
		throw new InvalidSnapshotError(
			`Settings file was written by a newer version of RES-Slim (file format ${formatVersion}, this build reads ${SNAPSHOT_FORMAT_VERSION}). ` +
			'Update RES-Slim and import it again. Nothing was changed.',
		);
	}
	if (formatVersion < MIN_SUPPORTED_FORMAT_VERSION) {
		throw new InvalidSnapshotError(
			`Settings file uses format ${formatVersion}, which this build no longer reads (oldest supported is ${MIN_SUPPORTED_FORMAT_VERSION}). Nothing was changed.`,
		);
	}

	return {
		app: SNAPSHOT_APP,
		appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : '',
		formatVersion: (formatVersion: any),
		exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
		modules: sanitized,
	};
}

// What to tell the user about where this file came from, or null when there is
// nothing worth saying. A snapshot from an older build still imports — that is
// the whole point of a stable format — but "these settings came from v0.31.0"
// is the context that explains why a module they do not recognise appeared.
export function describeSnapshotOrigin(snapshot: SettingsSnapshot, currentAppVersion: string): ?string {
	const parts = [];
	if (snapshot.formatVersion < SNAPSHOT_FORMAT_VERSION) {
		parts.push(`older file format ${snapshot.formatVersion}`);
	}
	if (snapshot.appVersion && currentAppVersion && snapshot.appVersion !== currentAppVersion) {
		parts.push(`exported by v${snapshot.appVersion}`);
	}
	return parts.length ? parts.join(', ') : null;
}

export async function applySnapshot(snapshot: SettingsSnapshot): Promise<{| moduleCount: number |}> {
	const moduleEntries = Object.entries(snapshot.modules);
	for (const [moduleID, blob] of moduleEntries) {
		// Persist the entire blob verbatim — unknown option keys from a future
		// schema must round-trip without being filtered out.
		await storage.set(moduleID, (blob: any)); // eslint-disable-line no-await-in-loop
	}
	return { moduleCount: moduleEntries.length };
}

export type SnapshotDiff = {|
	modulesAdded: string[],
	modulesChanged: string[],
	modulesUnchanged: number,
	// Modules present now that the incoming file does not mention. Import does not
	// delete them — naming them is the difference between "nothing happened to my
	// other settings" and the user assuming a full replacement.
	modulesUntouched: string[],
	optionsChanged: number,
|};

function optionValueOf(blob: mixed, key: string): mixed {
	if (!isPlainObject(blob)) return undefined;
	const entry = (blob: any)[key];
	return isPlainObject(entry) ? (entry: any).value : undefined;
}

// Pure, so the summary a user is shown can be tested without touching storage.
export function diffSnapshots(before: SettingsSnapshot, after: SettingsSnapshot): SnapshotDiff {
	const modulesAdded = [];
	const modulesChanged = [];
	let modulesUnchanged = 0;
	let optionsChanged = 0;

	for (const [moduleID, incoming] of Object.entries(after.modules)) {
		const current = before.modules[moduleID];
		if (current === undefined) {
			modulesAdded.push(moduleID);
			optionsChanged += Object.keys((incoming: any)).length;
			continue;
		}
		const keys = new Set([...Object.keys((current: any)), ...Object.keys((incoming: any))]);
		let changedHere = 0;
		for (const key of keys) {
			// Compare serialized values: option values are JSON-round-tripped
			// anyway, so structural equality is the only equality that matters.
			if (JSON.stringify(optionValueOf(current, key)) !== JSON.stringify(optionValueOf(incoming, key))) changedHere++;
		}
		if (changedHere) {
			modulesChanged.push(moduleID);
			optionsChanged += changedHere;
		} else {
			modulesUnchanged++;
		}
	}

	const incomingIDs = new Set(Object.keys(after.modules));
	const modulesUntouched = Object.keys(before.modules).filter(id => !incomingIDs.has(id));

	return {
		modulesAdded: modulesAdded.sort(),
		modulesChanged: modulesChanged.sort(),
		modulesUnchanged,
		modulesUntouched: modulesUntouched.sort(),
		optionsChanged,
	};
}

export function describeDiff(diff: SnapshotDiff): string {
	const parts = [];
	if (diff.optionsChanged) parts.push(`${diff.optionsChanged} option${diff.optionsChanged === 1 ? '' : 's'} changed`);
	if (diff.modulesChanged.length) parts.push(`${diff.modulesChanged.length} module${diff.modulesChanged.length === 1 ? '' : 's'} updated`);
	if (diff.modulesAdded.length) parts.push(`${diff.modulesAdded.length} added`);
	if (diff.modulesUntouched.length) parts.push(`${diff.modulesUntouched.length} left as-is`);
	return parts.length ? parts.join(', ') : 'no settings differed';
}

// The pre-import state, kept outside `RESoptions.` so it is never mistaken for a
// module blob and never re-exported as one.
const restorePointStorage = Storage.wrap('RES.settingsRestorePoint', (): ?SettingsSnapshot => null);

export function loadRestorePoint(): Promise<?SettingsSnapshot> {
	return restorePointStorage.get().then(value => {
		try {
			return value ? parseSnapshot(value) : null;
		} catch (e) {
			// A corrupt restore point must not block the console from loading.
			return null;
		}
	});
}

export function clearRestorePoint(): Promise<void> {
	return restorePointStorage.delete();
}

// Import is the one irreversible action in the product, so it is also the one
// that has to be able to put things back. Previously this wrote each module blob
// verbatim in a sequential loop with no backup and no rollback: a failure partway
// through left settings half-imported while the user was told the import failed,
// and there was no way back even from a fully successful one.
export async function applySnapshotGuarded(
	snapshot: SettingsSnapshot,
	{ appVersion }: {| appVersion: string |},
): Promise<{| moduleCount: number, diff: SnapshotDiff |}> {
	const backup = await buildSnapshot({ appVersion });
	const diff = diffSnapshots(backup, snapshot);

	// Written before the first mutation, so an interrupted run is still
	// recoverable by hand from storage even if the rollback below cannot run.
	await restorePointStorage.set((backup: any));

	try {
		const { moduleCount } = await applySnapshot(snapshot);
		return { moduleCount, diff };
	} catch (e) {
		try {
			await applySnapshot(backup);
		} catch (rollbackError) {
			// Both failed: say so precisely rather than reporting the first error
			// and implying settings are untouched.
			const original = e instanceof Error ? e.message : String(e);
			throw new Error(
				'Import failed and the settings could not be rolled back automatically. ' +
				'The pre-import settings are stored under "RES.settingsRestorePoint". ' +
				`Original error: ${original}`,
			);
		}
		throw e;
	}
}

export async function revertToRestorePoint(): Promise<{| moduleCount: number |}> {
	const backup = await loadRestorePoint();
	if (!backup) throw new Error('There is no saved pre-import state to restore.');
	const result = await applySnapshot(backup);
	await clearRestorePoint();
	return result;
}

export function serializeSnapshot(snapshot: SettingsSnapshot): string {
	return JSON.stringify(snapshot, null, '\t');
}

export function suggestedFilename(snapshot: SettingsSnapshot): string {
	const stamp = (snapshot.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-');
	return `res-slim-settings-${stamp}.json`;
}
