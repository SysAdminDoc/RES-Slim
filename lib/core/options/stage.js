/* @flow */

import { isEmpty, isEqual } from '../../utils/functional';
import * as Modules from '../modules';
import { save } from './options';
import { storage } from './storage';

let stagedOptions;
let stagedModules;

clearStagedOptions();

export { stageOption as add };
function stageOption(moduleID: string, optionName: string, optionValue: mixed) {
	const mod = Modules.get(moduleID);

	stagedOptions[moduleID] = stagedOptions[moduleID] || {};

	if (!isEqual(mod.options[optionName].value, optionValue)) {
		// new option value, add to stage
		stagedOptions[moduleID][optionName] = {
			value: optionValue,
		};
	} else {
		// staged value is the same as stored, remove option from stage
		delete stagedOptions[moduleID][optionName];
	}

	if (isEmpty(stagedOptions[moduleID])) {
		// no staged options for module, remove module from stage
		delete stagedOptions[moduleID];
	}
}

export { commitStagedOptions as commit };
async function commitStagedOptions() {
	const savedOptions = [];
	const savedModules = [];
	const previousOptionValues = [];

	// Every `save()` writes to storage as it goes, so a commit that failed partway
	// left the options that had landed sitting in storage while this catch put the
	// in-memory copy back. Discard then reported a rollback it had not done, and
	// the landed values came back on the next load. What storage holds for each
	// module the commit is about to touch is read first, so the catch can put
	// storage back where the console thinks it is.
	const storedBefore = await Promise.all(Object.keys(stagedOptions).map(
		async modId => [modId, await storage.getNullable(modId)],
	));
	// Enabling a module is the other write in here, under its own storage key, and
	// it has the same symptom: the switch goes back but the module stays on.
	const enabledBefore = Object.keys(stagedModules).map(moduleID => [moduleID, Modules.isEnabled(moduleID)]);

	try {
		for (const [modId, options] of Object.entries(stagedOptions)) {
			const module = Modules.get(modId);

			for (const [optionName, option] of Object.entries(options)) {
				const _option = module.options[optionName];
				previousOptionValues.push({ option: _option, value: _option.value });
				_option.value = option.value;
				savedOptions.push(save(_option));
			}
			savedModules.push({ module, options });
		}

		await settleAll(savedOptions);
		for (const { module, options } of savedModules) module.onSaveSettings(options);

		await settleAll(Object.entries(stagedModules).map(([moduleID, moduleEnabled]) => Modules.setEnabled(moduleID, moduleEnabled)));

		clearStagedOptions();
	} catch (e) {
		for (const { option, value } of previousOptionValues.reverse()) option.value = value;
		await restoreStoredValues(storedBefore, enabledBefore, e);
		throw e;
	}
}

// `Promise.all` raises the first failure while the other writes are still in
// flight, and one of those landing afterwards would put its value back behind
// the rollback. Every write is allowed to settle before the failure is raised.
async function settleAll(writes) {
	// $FlowIssue Promise#allSettled is not typed
	const results = await Promise.allSettled(writes);
	const failed = results.find(result => result.status === 'rejected');
	if (failed) throw failed.reason;
}

// Same shape as `applySnapshotGuarded`: when the rollback itself fails, say so
// precisely rather than reporting the original error, which reads as though
// storage were untouched.
async function restoreStoredValues(storedBefore, enabledBefore, cause) {
	try {
		await settleAll([
			...storedBefore.map(([modId, stored]) => (
				stored === null ? storage.delete(modId) : storage.set(modId, stored)
			)),
			...enabledBefore.map(([moduleID, wasEnabled]) => Modules.setEnabled(moduleID, wasEnabled)),
		]);
	} catch (restoreError) {
		const original = cause instanceof Error ? cause.message : String(cause);
		throw new Error(
			'Saving failed and the settings could not be put back automatically. ' +
			'Some of the changes may be stored even though this page is showing the old values. ' +
			`Original error: ${original}`,
			// $FlowIssue Error#cause is not typed
			({ cause: restoreError }: any),
		);
	}
}

export { clearStagedOptions as reset };
function clearStagedOptions() {
	stagedOptions = {};
	stagedModules = {};
}

export { hasStagedOptions as isDirty };
function hasStagedOptions() {
	return !isEmpty(stagedOptions) || !isEmpty(stagedModules);
}

export { getStagedOptions as get };
function getStagedOptions(moduleID: string) {
	return stagedOptions[moduleID];
}

export { stageModule as addModule };
function stageModule(moduleID: string, moduleEnabled: boolean) {
	if (Modules.isEnabled(moduleID) !== moduleEnabled) {
		stagedModules[moduleID] = moduleEnabled;
	} else {
		delete stagedModules[moduleID];
	}
}

export { getStagedModule as getModule };
function getStagedModule(moduleID: string) {
	if (((Object: any).hasOwn(stagedModules, moduleID))) {
		return stagedModules[moduleID];
	}
}

export { getStagedCounts as getCounts };
function getStagedCounts() {
	const optionCount = Object.values(stagedOptions).reduce((total, options) => total + Object.keys(options).length, 0);
	const moduleCount = Object.keys(stagedModules).length;
	const scopeCount = new Set([
		...Object.keys(stagedOptions),
		...Object.keys(stagedModules),
	]).size;

	return {
		optionCount,
		moduleCount,
		scopeCount,
	};
}
