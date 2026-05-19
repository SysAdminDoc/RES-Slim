/* @flow */

import { storage } from './storage';

export const SNAPSHOT_APP = 'res-slim';
export const SNAPSHOT_FORMAT_VERSION = 1;

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
	return {
		app: SNAPSHOT_APP,
		appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : '',
		formatVersion: typeof obj.formatVersion === 'number' ? (obj.formatVersion: any) : SNAPSHOT_FORMAT_VERSION,
		exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
		modules: sanitized,
	};
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

export function serializeSnapshot(snapshot: SettingsSnapshot): string {
	return JSON.stringify(snapshot, null, '\t');
}

export function suggestedFilename(snapshot: SettingsSnapshot): string {
	const stamp = (snapshot.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-');
	return `res-slim-settings-${stamp}.json`;
}
