/* @flow */

// The text a user pastes into a bug report.
//
// With 115 modules and no support channel, "X is broken" arrives with no
// context, and asking for it a question at a time is the expensive part. uBlock
// answers this with a redacted dump that lists **only what deviates from
// default**, which is what turns a 115-line report into a four-line one.
//
// Everything here is pure: it takes already-gathered values and returns a
// string. The gathering lives in `lib/options/supportDump.js`, so this half can
// be executed against hostile and empty inputs by a contract rather than having
// its source text asserted.

import type { ModuleErrorEntry } from './moduleErrorLog';
import type { DriftState } from './selectorDrift';
import { driftRecords, describeDriftScope, describeFinding } from './selectorDrift';

export type ModuleTimingSummary = {
	moduleID: string,
	totalMs: number,
	stages: { [string]: number },
};

export type OptionLike = {
	type?: string,
	value?: mixed,
	default?: mixed,
};

export type ModuleStateLike = {
	moduleID: string,
	enabled: boolean,
	defaultEnabled: boolean,
	options?: { [string]: OptionLike },
};

export type Deviation = {|
	moduleID: string,
	key: ?string,
	value: string,
	defaultValue: string,
|};

export type SupportDumpInput = {|
	version: string,
	browser: string,
	browserVersion: string,
	os: string,
	renderer: ?string,
	pageType: ?string,
	generatedAt: number,
	timings: ?$ReadOnlyArray<ModuleTimingSummary>,
	deviations: $ReadOnlyArray<Deviation>,
	errors: $ReadOnlyArray<ModuleErrorEntry>,
	drift: DriftState,
|};

export const TIMING_LIMIT = 8;
export const ERROR_LIMIT = 10;
const MAX_VALUE_LENGTH = 60;

// Which option types may have their value printed verbatim.
//
// The split is closed vocabulary against open text, not "is it interesting".
// `enum`, `select`, `boolean`, `keycode` and `color` can only hold values the
// module itself defined or a key chord, so printing one reveals nothing the
// settings page does not already show a supporter asking "what did you pick".
// `text`, `list`, `table` and `builder` hold whatever the user typed: subreddit
// lists, usernames, filter rules, and — in a table's `password` field — a
// credential. Those report their shape and never their contents.
const VERBATIM_TYPES = new Set(['boolean', 'enum', 'select', 'keycode', 'color']);

function truncate(value: string): string {
	return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
}

export function describeOptionValue(type: ?string, value: mixed): string {
	if (value === undefined) return 'unset';
	if (value === null) return 'none';

	if (Array.isArray(value)) {
		// A keycode is a fixed-length array of a key code and four modifier
		// booleans, so it is a value, not a collection.
		if (type === 'keycode') return `[${value.map(part => String(part)).join(', ')}]`;
		return value.length === 1 ? '1 row' : `${value.length} rows`;
	}

	if (typeof value === 'boolean') return value ? 'on' : 'off';
	if (typeof value === 'number') return String(value);

	if (typeof value === 'string') {
		if (type && VERBATIM_TYPES.has(type)) return truncate(value) || 'empty';
		if (!value) return 'empty';
		if (type === 'list') {
			const entries = value.split(',').map(part => part.trim()).filter(Boolean);
			return entries.length === 1 ? '1 entry' : `${entries.length} entries`;
		}
		return value.length === 1 ? 'set (1 character)' : `set (${value.length} characters)`;
	}

	if (typeof value === 'object') return 'set';
	return 'set';
}

function sameValue(a: mixed, b: mixed): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		// `other` rather than `b` directly: Flow 0.84 drops the `Array.isArray`
		// refinement when the value is read inside a closure, and a `const` bound
		// after the check keeps it.
		const other = b;
		return a.length === other.length && a.every((entry, index) => sameValue(entry, other[index]));
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		try {
			return JSON.stringify(a) === JSON.stringify(b);
		} catch (e) {
			// A cyclic option value is not something this can compare, and
			// reporting it as changed is the harmless direction.
			return false;
		}
	}
	return false;
}

export function collectDeviations(modules: $ReadOnlyArray<ModuleStateLike>): Deviation[] {
	const deviations = [];

	for (const module of modules) {
		if (!module || typeof module.moduleID !== 'string' || !module.moduleID) continue;

		if (module.enabled !== module.defaultEnabled) {
			deviations.push({
				moduleID: module.moduleID,
				key: null,
				value: module.enabled ? 'on' : 'off',
				defaultValue: module.defaultEnabled ? 'on' : 'off',
			});
		}

		const options = module.options;
		if (!options || typeof options !== 'object') continue;

		for (const key of Object.keys(options)) {
			const option = options[key];
			if (!option || typeof option !== 'object') continue;
			// `_loadModuleOptions` copies `value` into `default` before applying
			// anything stored, so an option with no `default` was never loaded and
			// there is nothing to compare against.
			if (!Object.hasOwn(option, 'default')) continue;
			if (option.type === 'button') continue;
			if (sameValue(option.value, option.default)) continue;

			deviations.push({
				moduleID: module.moduleID,
				key,
				value: describeOptionValue(option.type, option.value),
				defaultValue: describeOptionValue(option.type, option.default),
			});
		}
	}

	return deviations;
}

function describeStages(stages: { [string]: number }): string {
	return Object.keys(stages)
		.sort((a, b) => stages[b] - stages[a])
		.map(stage => `${stage} ${stages[stage]}ms`)
		.join(', ');
}

function section(title: string, lines: $ReadOnlyArray<string>): string[] {
	return lines.length ? ['', title, ...lines.map(line => `  ${line}`)] : [];
}

export function formatSupportDump(input: SupportDumpInput): string {
	const lines = [
		`RES-Slim v${input.version}`,
		`Browser: ${input.browser} ${input.browserVersion} on ${input.os}`,
		`Page: ${input.renderer || 'not a reddit page'}${input.pageType ? ` (${input.pageType})` : ''}`,
		`Generated: ${new Date(input.generatedAt).toISOString()}`,
	];

	const deviations = input.deviations.map(d => (
		d.key ?
			`${d.moduleID}.${d.key}: ${d.value} (default ${d.defaultValue})` :
			`${d.moduleID}: ${d.value} (default ${d.defaultValue})`
	));
	lines.push(...(deviations.length ?
		section(`Settings that differ from default (${deviations.length})`, deviations) :
		['', 'Settings that differ from default: none']));

	const timings = input.timings;
	if (!timings) {
		// Timings live in the content script on the reddit page. Opening the
		// console as its own tab means there is no page to ask, and saying so is
		// better than a heading with nothing under it.
		lines.push('', 'Slowest modules: unavailable (open the settings console from a reddit page)');
	} else if (!timings.length) {
		lines.push('', 'Slowest modules: none recorded');
	} else {
		const shown = timings.slice(0, TIMING_LIMIT);
		lines.push(...section(
			`Slowest modules (${shown.length} of ${timings.length})`,
			shown.map(t => `${t.moduleID} ${t.totalMs}ms — ${describeStages(t.stages)}`),
		));
	}

	const errors = input.errors.slice(0, ERROR_LIMIT).map(entry => (
		`[${new Date(entry.timestamp).toISOString()}] ${entry.moduleID} (${entry.stage}): ${entry.message}`
	));
	lines.push(...(errors.length ?
		section(`Recent module errors (${errors.length} of ${input.errors.length})`, errors) :
		['', 'Recent module errors: none']));

	const drift = [];
	for (const record of driftRecords(input.drift)) {
		drift.push(`${describeDriftScope(record.pageType)}:`);
		for (const finding of record.findings) drift.push(`  ${describeFinding(finding)}`);
	}
	lines.push(...(drift.length ?
		section('Selector drift', drift) :
		['', 'Selector drift: none']));

	return `${lines.join('\n')}\n`;
}

export type PageDiagnostics = {|
	renderer: ?string,
	pageType: ?string,
	timings: ModuleTimingSummary[],
|};

// The console is an iframe on a reddit page and asks that page for its module
// timings, because the timings are collected in the content script and the
// console is a different document. `settingsNavigation` already checks the
// sender's origin; this checks the *payload*, on the same reasoning as
// `sanitizeContext`: several different message shapes are posted to that window,
// so the handler has to recognise its own rather than assume any message is one.
//
// Returns null when the payload is not a diagnostics reply. Never throws.
export function sanitizePageDiagnostics(payload: mixed): PageDiagnostics | null {
	if (!payload || typeof payload !== 'object') return null;
	const diagnostics = (payload: any).diagnostics;
	if (!diagnostics || typeof diagnostics !== 'object') return null;

	const rawTimings = Array.isArray(diagnostics.timings) ? diagnostics.timings : [];
	const timings = rawTimings
		.map(raw => {
			if (!raw || typeof raw !== 'object' || typeof raw.moduleID !== 'string' || !raw.moduleID) return null;
			const totalMs = Number(raw.totalMs);
			if (!Number.isFinite(totalMs)) return null;
			const stages = {};
			if (raw.stages && typeof raw.stages === 'object') {
				for (const stage of Object.keys(raw.stages)) {
					const duration = Number(raw.stages[stage]);
					if (Number.isFinite(duration)) stages[stage] = duration;
				}
			}
			return { moduleID: raw.moduleID, totalMs, stages };
		})
		.filter(Boolean);

	return {
		renderer: typeof diagnostics.renderer === 'string' ? diagnostics.renderer : null,
		pageType: typeof diagnostics.pageType === 'string' ? diagnostics.pageType : null,
		timings,
	};
}
