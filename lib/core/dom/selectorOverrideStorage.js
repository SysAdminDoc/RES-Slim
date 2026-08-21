/* @flow */

import * as Storage from '../../environment/foreground/storage';
import {
	SELECTOR_OVERRIDE_STORAGE_KEY,
	getSelectorOverrides,
	normalizeSelectorOverrides,
	resetSelectorOverrides,
	setSelectorOverrides,
} from './selectors';
import type { SelectorOverrides } from './selectors';

const overrideStorage = Storage.wrap(SELECTOR_OVERRIDE_STORAGE_KEY, null);

export async function loadSelectorOverrides(): Promise<SelectorOverrides> {
	try {
		const stored = await overrideStorage.get();
		if (stored === null) {
			resetSelectorOverrides();
			return getSelectorOverrides();
		}
		return setSelectorOverrides(stored);
	} catch (error) {
		resetSelectorOverrides();
		return getSelectorOverrides();
	}
}

export function readSelectorOverrides(): Promise<SelectorOverrides> {
	return loadSelectorOverrides();
}

export async function saveSelectorOverrides(raw: mixed): Promise<SelectorOverrides> {
	const normalized = normalizeSelectorOverrides(raw);
	await overrideStorage.set(normalized);
	return setSelectorOverrides(normalized);
}

export async function clearSelectorOverrides(): Promise<SelectorOverrides> {
	await overrideStorage.delete();
	resetSelectorOverrides();
	return getSelectorOverrides();
}
