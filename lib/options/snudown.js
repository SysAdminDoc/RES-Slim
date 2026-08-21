/* @flow */

export function markdown(...args: Array<any>): string {
	const renderer = (window: any).RESOptionsMarkdown;
	if (typeof renderer !== 'function') throw new Error('The settings Markdown renderer did not load');
	return renderer(...args);
}
