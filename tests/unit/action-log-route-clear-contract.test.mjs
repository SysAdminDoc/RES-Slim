// The log is per page, and opening the settings is not a new page.
//
// Current Reddit is a single page application whose document lives for the whole
// session, so "per page" has to be enforced rather than assumed: without a clear
// on navigation the ring spans every subreddit and profile the reader visited,
// and that is what a support report samples.
//
// The trap is what counts as navigation. `reddit.urlChanged` fires on any change
// to `location.href`, and the settings console changes it itself -- every load
// writes the console's own hash back through `setHash`, which is a `pushState`,
// which the current-Reddit watcher reports as a route change. Clearing on that
// emptied the log a moment before the panel that exists to read it was told to
// read it, and the report then said nothing had happened on a page where plenty
// had. The path is what makes it a different page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const Nav = await loadModule('lib/modules/settingsNavigation.js', 'action-log-route-clear', {
	stubEnvironment: true,
	dom: { url: 'https://www.reddit.com/r/example/comments/abc/title/', html: '<!doctype html><html><body><shreddit-app></shreddit-app></body></html>' },
	alsoExport: { log: 'lib/utils/actionLog.js' },
});

const { log } = Nav;

function record(count = 3) {
	log.clearActionLog();
	for (const index of Array.from({ length: count }, (_, at) => at)) {
		log.recordAction({ moduleID: 'filterRules', outcome: 'hidden', target: `t3_${index}`, reason: 'rule-1' });
	}
}

function changeRoute() {
	document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
}

Nav.module.contentStart();

test('opening the settings does not throw away what the settings are there to show', () => {
	record();
	assert.equal(log.actionLogSize(), 3);

	// What the console does on load, and again on every panel it opens.
	history.pushState({}, '', '#res:settings/console');
	changeRoute();
	assert.equal(log.actionLogSize(), 3, 'the console emptied the log by opening');

	history.pushState({}, '', '#res:settings/filterRules');
	changeRoute();
	history.replaceState({}, '', '#res:settings');
	changeRoute();
	assert.equal(log.actionLogSize(), 3, 'moving between settings panels emptied the log');

	// And closing it, which pushes state one more time.
	history.pushState({}, '', location.pathname);
	changeRoute();
	assert.equal(log.actionLogSize(), 3, 'closing the console emptied the log');
});

test('a query the page changes for itself is not a new page either', () => {
	record();
	history.pushState({}, '', `${location.pathname}?sort=new`);
	changeRoute();
	assert.equal(log.actionLogSize(), 3, 're-sorting the comments emptied the log');
});

test('going somewhere else does clear it', () => {
	// The whole reason the listener exists. A record of what you were reading must
	// not follow you to the next thing you read.
	record();
	history.pushState({}, '', '/r/other/comments/xyz/title/');
	changeRoute();
	assert.equal(log.actionLogSize(), 0, 'the log followed the reader to another post');

	// And the next route change from there is judged against where it is now, not
	// against where the reader started.
	record();
	changeRoute();
	assert.equal(log.actionLogSize(), 3, 'a repeat event on the same path cleared it again');

	history.pushState({}, '', '/r/other/');
	changeRoute();
	assert.equal(log.actionLogSize(), 0);
});
