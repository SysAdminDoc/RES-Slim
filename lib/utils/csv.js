/* @flow */
// Pure CSV cell encoder shared by export features. Does two things:
//  1. Neutralizes spreadsheet formula injection — a cell whose text starts with
//     =, +, -, @, tab, or CR is evaluated as a formula by Excel/LibreOffice, so
//     remote-controlled fields (usernames, comment snippets) could run
//     =HYPERLINK(...) / =cmd|... payloads when the export is opened. We prefix
//     such cells with a single quote. Plain numbers (incl. negatives like -5)
//     are left alone so numeric columns stay numeric.
//  2. Applies RFC-4180 quoting for commas, quotes, and newlines.
// Dependency-free for unit testing.

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

export function csvCell(value: mixed): string {
	let s = String(value == null ? '' : value);
	if (FORMULA_LEAD.test(s) && !PLAIN_NUMBER.test(s)) {
		s = `'${s}`;
	}
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

export function toCsvRow(cells: $ReadOnlyArray<mixed>): string {
	return cells.map(csvCell).join(',');
}
