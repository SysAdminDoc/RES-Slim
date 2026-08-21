/* @flow */

export function markdown(...args: Array<any>): string {
	const renderers = (window: any).RESSnudown;
	if (!renderers || typeof renderers.markdown !== 'function') throw new Error('The settings Markdown renderer did not load');
	return renderers.markdown(...args);
}
