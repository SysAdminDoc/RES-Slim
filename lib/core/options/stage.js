/* @flow */

import { isEmpty, isEqual } from '../../utils/functional';
import { i18n } from '../../environment';
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
	// Which keys inside each blob this commit is about to write. The rollback puts
	// those back and leaves the rest of the blob as it finds it: a content script
	// writes into the same blob for a different option -- `userTagger`,
	// `subredditBlacklist` and `commentNavigator` all do -- and the per-key mutex
	// is per JavaScript context, so it does not order this page against a reddit
	// tab. Restoring the snapshot wholesale would take that tab's write with it.
	const touchedKeys = Object.entries(stagedOptions).map(([modId, options]) => [modId, Object.keys(options)]);
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

		// A rejection here leaves the other writes in flight, which sounds like it
		// could let one land on top of the rollback. It cannot: every *write* to a
		// module blob goes through `withLockOn(key)`, a per-key mutex that runs
		// queued work in the order it was issued, and the rollback's write for that
		// key is issued last. Reads are a different matter -- see
		// `restoreBlobKeys`. Waiting for every write to settle first was tried and
		// reverted: it buys nothing the mutex does not already give, and a write
		// whose callback never fires -- an extension reload while the options page
		// is open -- would then hang the save with no error and no way out.
		await Promise.all(savedOptions);
		for (const { module, options } of savedModules) module.onSaveSettings(options);

		await Promise.all(Object.entries(stagedModules).map(([moduleID, moduleEnabled]) => Modules.setEnabled(moduleID, moduleEnabled)));

		clearStagedOptions();
	} catch (e) {
		for (const { option, value } of previousOptionValues.reverse()) option.value = value;
		await restoreStoredValues(storedBefore, touchedKeys, enabledBefore, e);
		throw e;
	}
}

// Same shape as `applySnapshotGuarded`: when the rollback itself fails, say so
// precisely rather than reporting the original error, which reads as though
// storage were untouched.
async function restoreStoredValues(storedBefore, touchedKeys, enabledBefore, cause) {
	const before = new Map(storedBefore);

	try {
		await Promise.all([
			...touchedKeys.map(([modId, keys]) => restoreBlobKeys(modId, keys, before.get(modId))),
			...enabledBefore.map(([moduleID, wasEnabled]) => Modules.setEnabled(moduleID, wasEnabled)),
		]);
	} catch (restoreError) {
		const original = cause instanceof Error ? cause.message : String(cause);
		throw new Error(
			i18n('settingsSaveRollbackFailed', original),
			// $FlowIssue Error#cause is not typed
			({ cause: restoreError }: any),
		);
	}
}

async function restoreBlobKeys(modId, keys, stored) {
	// Both halves read and write inside the per-key lock. Reading the blob here
	// and writing it back whole -- which is what this did first -- is not safe
	// even though `set` takes the lock, because the *read* does not: `wrapPrefix`
	// batches reads on Chrome, so `getNullable` goes straight to
	// `chrome.storage.local.get` and takes nothing. A write from a content script
	// landing between that read and the write was then destroyed, which is the
	// failure restoring per key was introduced to prevent in the first place.
	const restore = {};
	const remove = [];
	for (const key of keys) {
		if (stored && Object.hasOwn(stored, key)) restore[key] = stored[key];
		else remove.push(key);
	}

	if (Object.keys(restore).length) await storage.patchShallow(modId, restore);
	// A key the failed commit created has to go, and `deletePath` is the removal
	// that reads and writes under the lock. A module that had no blob at all is
	// left holding an empty one rather than none: `prune` deletes those on the
	// next load and `_loadModuleOptions` reads one as "nothing stored", which is a
	// cheaper price than a read-modify-write that can lose another tab's option.
	await Promise.all(remove.map(key => storage.deletePath(modId, key)));
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
