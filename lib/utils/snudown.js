/* @flow */

import { loadScript } from '../environment/foreground/loadScript';

type SnudownRenderers = {|
	markdown: (...args: Array<any>) => string,
	markdownWiki: (...args: Array<any>) => string,
|};

let loading: ?Promise<SnudownRenderers>;

export function getLoadedSnudown(): SnudownRenderers {
	const renderers = (window: any).RESSnudown;
	if (!renderers || typeof renderers.markdown !== 'function' || typeof renderers.markdownWiki !== 'function') {
		throw new Error('The Reddit Markdown renderer did not load');
	}
	return renderers;
}

export function loadSnudown(): Promise<SnudownRenderers> {
	try {
		return Promise.resolve(getLoadedSnudown());
	} catch (e) {
		if (!loading) {
			loading = loadScript('/snudown.entry.js')
				.then(getLoadedSnudown)
				.catch(error => {
					loading = null;
					throw error;
				});
		}
		return loading;
	}
}
