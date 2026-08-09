/* @flow */

import * as Storage from '../../environment/foreground/storage';
import {
	appendModuleError,
	normalizeModuleErrorEntries,
} from '../../utils/moduleErrorLog';
import type { ModuleErrorEntry } from '../../utils/moduleErrorLog';

export const storage = Storage.wrapBlob('RES.modulePrefs',
	(): boolean => { throw new Error('Default module enabled state should never be accessed'); });

export function setEnabled(moduleId: string, enable: boolean) {
	return storage.set(moduleId, enable);
}

const moduleErrorStorage = Storage.wrap('RES.moduleErrorLog', (): ModuleErrorEntry[] => []);
let moduleErrorWriteQueue: Promise<void> = Promise.resolve();

export function getModuleErrorLog(): Promise<ModuleErrorEntry[]> {
	return moduleErrorStorage.get().then(normalizeModuleErrorEntries);
}

export function recordModuleError(entry: ModuleErrorEntry): Promise<void> {
	const write = moduleErrorWriteQueue.then(async () => {
		const existing = await getModuleErrorLog();
		await moduleErrorStorage.set(appendModuleError(existing, entry));
	});
	moduleErrorWriteQueue = write.catch(() => {});
	return write;
}

export function clearModuleErrorLog(): Promise<void> {
	const clear = moduleErrorWriteQueue.then(() => moduleErrorStorage.delete());
	moduleErrorWriteQueue = clear.catch(() => {});
	return clear;
}
