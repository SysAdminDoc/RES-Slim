/* @flow */

// What is left of the upstream table helper. The `RESTable` class was 177 of
// this file's 220 lines and had no caller anywhere in lib, tests or scripts:
// upstream built its settings tables with it, and this fork does not. Its
// registry is gone with it, which also settles the first branch of the sort
// below - nothing was ever in the map to find.

import { downcast } from '../utils';
import { memoize } from './functional';

export function sortByColumn({ target: sortColumn }: MouseEvent) {
	const table = downcast(sortColumn.closest('table'), HTMLTableElement);

	const reverseCurrent = sortColumn.classList.contains('sort-asc') || sortColumn.classList.contains('sort-asc');

	const tbody = table.querySelector('tbody');
	const columns = Array.from(table.querySelectorAll('thead th'));
	const rows = Array.from(tbody.querySelectorAll('tr'));

	if (reverseCurrent) {
		rows.reverse();
	} else {
		const index = columns.indexOf(sortColumn);
		const getCellValue = memoize(row => { const cell = row.querySelectorAll('td')[index]; return cell.textContent; });
		rows.sort((rowA, rowB) => getCellValue(rowA).localeCompare(getCellValue(rowB), undefined, { numeric: true }));
	}

	tbody.append(...rows);

	if (reverseCurrent) {
		sortColumn.classList.toggle('sort-asc');
		sortColumn.classList.toggle('sort-desc');
	} else {
		const previous = table.querySelector('.sort-asc, .sort-desc');
		if (previous) previous.classList.remove('sort-asc');
		if (previous) previous.classList.remove('sort-desc');
		sortColumn.classList.add('sort-asc');
	}
}
