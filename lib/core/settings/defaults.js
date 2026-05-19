/* @flow */

import {
	AUTO_DEFAULT,
	CURRENT_DEFAULT,
	settingsSchema,
} from './schema';

function cloneValue(value) {
	if (Array.isArray(value)) return [...value];
	if (value && typeof value === 'object') return { ...value };
	return value;
}

export function resolveSettingDefault(definition, currentValues = {}, environment = {}) {
	if (definition.defaultValue === CURRENT_DEFAULT) {
		if (Object.hasOwn(currentValues, definition.key)) return currentValues[definition.key];
		if (Object.hasOwn(currentValues, definition.featureId)) return currentValues[definition.featureId];
		return true;
	}

	if (definition.defaultValue === AUTO_DEFAULT) {
		if (definition.key === 'rsm.a11y.reducedMotion.enabled' && environment.prefersReducedMotion !== undefined) {
			return !!environment.prefersReducedMotion;
		}
		if (definition.key === 'rsm.core.userscriptCompat.enabled' && environment.isUserscript !== undefined) {
			return !!environment.isUserscript;
		}
		return AUTO_DEFAULT;
	}

	return cloneValue(definition.defaultValue);
}

export function getDefaultSettings({ currentValues = {}, environment = {} } = {}) {
	return Object.fromEntries(settingsSchema.map(definition => [
		definition.key,
		resolveSettingDefault(definition, currentValues, environment),
	]));
}

export function mergeWithDefaults(values = {}, options = {}) {
	return {
		...getDefaultSettings(options),
		...values,
	};
}

export function serializeDefaultsForStorage(options = {}) {
	const defaults = getDefaultSettings(options);
	return {
		version: 1,
		values: defaults,
	};
}
