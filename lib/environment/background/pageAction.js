/* @flow */

import { addListener, sendMessage } from './messaging';

const pageAction = chrome[process.env.BUILD_TARGET === 'firefox' ? 'pageAction' : 'action'];

pageAction.onClicked.addListener(tab => {
	sendMessage('pageActionClick', undefined, tab.id);
});

function showPageAction(tabId) {
	return process.env.BUILD_TARGET === 'firefox' ? pageAction.show(tabId) : pageAction.enable(tabId);
}

function hidePageAction(tabId) {
	return process.env.BUILD_TARGET === 'firefox' ? pageAction.hide(tabId) : pageAction.disable(tabId);
}

addListener('pageAction', ({ operation, state }, { tab }) => {
	switch (operation) {
		case 'show':
			showPageAction(tab.id);
			pageAction.setIcon({
				tabId: tab.id,
				path: {
					'16': state ? 'css-on-small.png' : 'css-off-small.png', // eslint-disable-line quote-props
					'32': state ? 'css-on.png' : 'css-off.png', // eslint-disable-line quote-props
				},
			});
			pageAction.setTitle({
				tabId: tab.id,
				title: state ? 'Subreddit Style On' : 'Subreddit Style Off',
			});
			break;
		case 'hide':
			hidePageAction(tab.id);
			break;
		default:
			throw new Error(`Invalid action operation: ${operation}`);
	}
});
