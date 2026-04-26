/* @flow */

import { sendMessage } from './messaging';

export function download(url: string, filename?: string): Promise<*> {
	// Firefox and Chrome <a download> is same-origin only
	return sendMessage('download', {
		// resolve relative URLs
		url: new URL(url, location.href).href,
		filename,
	});
}
