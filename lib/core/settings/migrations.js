/* @flow */

import { mergeWithDefaults } from './defaults';
import { getSettingDefinition } from './schema';

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

function toValues(snapshot) {
	if (!snapshot) return {};
	if (snapshot.values && typeof snapshot.values === 'object') return snapshot.values;
	return snapshot;
}

export function normalizeSettingsSnapshot(snapshot, options = {}) {
	const values = toValues(snapshot);
	return {
		version: CURRENT_SETTINGS_SCHEMA_VERSION,
		values: mergeWithDefaults(values, options),
	};
}

export function migrateSettingsSnapshot(snapshot, options = {}) {
	const normalized = normalizeSettingsSnapshot(snapshot, options);
	const migrated = { ...normalized.values };

	for (const [key, value] of Object.entries(migrated)) {
		const definition = getSettingDefinition(key);
		if (!definition || definition.type !== 'boolean') continue;
		if (value === 'on') migrated[key] = true;
		if (value === 'off') migrated[key] = false;
	}

	return {
		version: CURRENT_SETTINGS_SCHEMA_VERSION,
		values: migrated,
	};
}

export function extractKnownSettings(snapshot, options = {}) {
	const migrated = migrateSettingsSnapshot(snapshot, options);
	return {
		version: migrated.version,
		values: Object.fromEntries(
			Object.entries(migrated.values).filter(([key]) => getSettingDefinition(key)),
		),
	};
}
