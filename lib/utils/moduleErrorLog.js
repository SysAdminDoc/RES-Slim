/* @flow */

export const MODULE_ERROR_LOG_CAP = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 2400;

export type ModuleErrorEntry = {|
	moduleID: string,
	stage: string,
	timestamp: number,
	message: string,
	stack: string,
|};

function truncate(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function text(value: mixed, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed ? trimmed : fallback;
}

export function describeModuleError(error: mixed): {| message: string, stack: string |} {
	const candidate: any = error;
	const message = text(
		candidate && typeof candidate === 'object' ? candidate.message : error,
		'Unknown error',
	);
	const stack = text(candidate && typeof candidate === 'object' ? candidate.stack : '', '');
	return {
		message: truncate(message, MAX_MESSAGE_LENGTH),
		stack: truncate(stack, MAX_STACK_LENGTH),
	};
}

export function makeModuleErrorEntry(moduleID: string, stage: string, error: mixed, timestamp: number = Date.now()): ModuleErrorEntry {
	const detail = describeModuleError(error);
	return {
		moduleID: text(moduleID, 'unknown-module'),
		stage: text(stage, 'unknown-stage'),
		timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
		message: detail.message,
		stack: detail.stack,
	};
}

function normalizeEntry(raw: mixed): ?ModuleErrorEntry {
	if (!raw || typeof raw !== 'object') return null;
	const candidate: any = raw;
	const timestamp = Number(candidate.timestamp);
	if (!Number.isFinite(timestamp) || !candidate.moduleID || !candidate.stage) return null;
	const detail = describeModuleError({ message: candidate.message, stack: candidate.stack });
	return makeModuleErrorEntry(String(candidate.moduleID), String(candidate.stage), detail, timestamp);
}

export function normalizeModuleErrorEntries(raw: mixed): ModuleErrorEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map(normalizeEntry)
		.filter(Boolean)
		.slice(0, MODULE_ERROR_LOG_CAP);
}

export function appendModuleError(rawEntries: mixed, entry: ModuleErrorEntry, cap: number = MODULE_ERROR_LOG_CAP): ModuleErrorEntry[] {
	const safeCap = Math.max(1, Math.floor(Number(cap)) || MODULE_ERROR_LOG_CAP);
	return [entry, ...normalizeModuleErrorEntries(rawEntries)].slice(0, safeCap);
}

export function formatModuleErrorLog(entries: $ReadOnlyArray<ModuleErrorEntry>): string {
	return entries.map(entry => {
		const header = `[${new Date(entry.timestamp).toISOString()}] ${entry.moduleID} (${entry.stage})`;
		return `${header}\n${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`;
	}).join('\n\n');
}
