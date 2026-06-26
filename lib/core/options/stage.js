/* @flow */

import { isEmpty, isEqual } from '../../utils/functional';
import * as Modules from '../modules';
import { save } from './options';

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

		await Promise.all(savedOptions);
		for (const { module, options } of savedModules) module.onSaveSettings(options);

		await Promise.all(Object.entries(stagedModules).map(([moduleID, moduleEnabled]) => Modules.setEnabled(moduleID, moduleEnabled)));

		clearStagedOptions();
	} catch (e) {
		for (const { option, value } of previousOptionValues.reverse()) option.value = value;
		throw e;
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
