/* @flow */

import { Module } from '../core/module';
import { Storage, isPrivateBrowsing } from '../environment';
import {
	Thing,
	SelectedThing,
	batch,
	execRegexes,
	maybePruneOldEntries,
} from '../utils';

export const module: Module<*> = new Module('readComments');

module.moduleName = 'readCommentsName';
module.category = 'commentsCategory';
module.description = 'readCommentsDesc';
module.options = {
	cleanComments: {
		type: 'text',
		value: '30',
		description: 'readCommentsCleanCommentsDesc',
		title: 'readCommentsCleanCommentsTitle',
		advanced: true,
	},
	monitorSelected: {
		type: 'boolean',
		value: true,
		description: 'readCommentsMonitorSelectedDesc',
		title: 'readCommentsMonitorSelectedTitle',
	},
	monitorWhenIncognito: {
		type: 'boolean',
		value: false,
		dependsOn: () => module.options.monitorSelected.value,
		description: 'readCommentsMonitorWhenIncognitoDesc',
		title: 'readCommentsMonitorWhenIncognitoTitle',
		advanced: true,
	},
};

module.include = ['comments', 'commentsLinklist'];

const currentId = (execRegexes.comments(location.pathname) || [])[2] || location.pathname;
const entryStorage = Storage.wrapPrefix('readComments.', (): {|
	updateTime: number,
	ids: { [string]: true },
|} => ({
	updateTime: Date.now(),
	ids: {},
}));

const initial = entryStorage.get(currentId);
let initialReadIds;

module.beforeLoad = async () => {
	initialReadIds = await (initial.then(({ ids }) => new Set(Object.keys(ids))));

	if (module.options.monitorSelected.value) {
		if (!module.options.monitorWhenIncognito.value && isPrivateBrowsing()) return;

		SelectedThing.addListener(current => {
			if (current.isComment() && current.isVisible()) add(current);
		}, 'beforePaint');
	}

	maybePruneOldEntries('readComments', entryStorage, parseInt(module.options.cleanComments.value, 10));
};

const _add = batch(ids => (
	entryStorage.patch(
		currentId,
		{ ids: ids.reduce((acc, id) => { acc[id] = true; return acc; }, {}), updateTime: Date.now() },
	)
), { size: Infinity, delay: 5000, flushBeforeUnload: true });

export const add = (thing: Thing) => {
	if (!initialReadIds) throw new Error('readComments module is not initialized');
	const id = thing.getFullname();
	_add(id);
};

export const isRead = (thing: *) => {
	if (!initialReadIds) throw new Error();
	return initialReadIds.has(thing.getFullname());
};
