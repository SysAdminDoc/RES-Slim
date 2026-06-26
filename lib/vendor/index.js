/* @flow */

import { makeSortable } from '../utils/nativeSortable';

export const Sortable = {
	create(container: HTMLElement, options: {| handle: string, group?: string |}) {
		makeSortable(container, options);
	},
};
