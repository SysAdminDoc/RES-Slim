/* @flow */
// RES-Slim: local-only vote/read history log. Every up/downvote the user
// casts on old.reddit is recorded to IndexedDB along with a snippet and the
// score-at-time. Nothing leaves the browser. Browseable from the userbar
// `vote log` link; exportable as JSON or CSV.

import { Module } from '../core/module';
import { findSurface, getStableSelector } from '../core/dom/selectors';
import { DATA_WORKSPACE_ROUTE } from '../constants/settingsCategories';
import { canPersistFeatureData } from '../environment';
import { countRecords, trimRecords, writeRecords } from '../environment/foreground/featureDb';
import { Thing, appType, watchForThings } from '../utils';
import {
	buildRecord,
	classifyDirection,
} from '../utils/voteHistory';
import type { VoteDirection, VoteRecord } from '../utils/voteHistory';
import { makeUrlHash } from './settingsNavigation';

export const module: Module<{ [string]: any }> = new Module('voteHistory');

module.moduleName = 'Local vote / read history log';
module.category = 'productivityCategory';
module.description = 'Records every vote you cast on classic or current Reddit to IndexedDB along with a snippet, the score-at-time, and a timestamp. Private-window votes are never recorded. Browsable + exportable. Nothing leaves the browser.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.disabledByDefault = true;
module.keywords = ['vote', 'history', 'log', 'idb', 'backup'];

module.options = {
	recordVotes: {
		type: 'boolean',
		value: true,
		title: 'Record votes',
		description: 'Log up/down/unvote events. Disable to keep the existing log read-only.',
	},
	maxRecords: {
		type: 'text',
		value: '50000',
		title: 'Max records',
		description: 'Hard cap on stored records. Oldest entries are dropped first when the cap is exceeded.',
	},
	snippetLength: {
		type: 'text',
		value: '240',
		title: 'Snippet length',
		description: 'Characters of body text saved per record. Defaults to 240.',
	},
};

const TRIGGER_ID = 'rsm-voteHistory-trigger';

// The records live in the extension's own database, reached over the background
// bridge. A content script's `indexedDB` is reddit.com's, and putting the log
// there is what kept it unreadable from the settings page.
// Oldest first, and the only index this store has that means "age".
const TRIM_INDEX = 'timestamp';

async function putRecord(record: VoteRecord): Promise<void> {
	if (!canPersistFeatureData('voteHistory')) return;
	await writeRecords('voteHistory', [record]);
}

// Runs after every vote, so what it costs when there is nothing to do is what it
// costs. It used to read the whole store, sort it in the content script and send
// the overflow ids back: at the default cap of fifty thousand records with
// 240-character snippets, one vote click marshalled tens of megabytes through
// `chrome.runtime.sendMessage` and threw all of it away.
//
// A count answers the only question the common case has, and the trim walks the
// `timestamp` index in the background where the records already are.
// Exported for the contract. What this costs when there is nothing to do is the
// whole point of it, and that is not observable from the vote handler.
export async function _pruneIfNeeded(): Promise<void> {
	if (!canPersistFeatureData('voteHistory')) return;
	// `|| 50000` would make a typed 0 mean "the default" rather than "as few as
	// you will let me", which is the opposite of what typing 0 asks for. The
	// floor of 100 is what actually protects the store.
	const typed = parseInt(String(module.options.maxRecords.value), 10);
	const max = Math.max(100, Number.isFinite(typed) ? typed : 50000);
	// Counted over the same index the trim walks.
	//
	// IndexedDB leaves a record out of an index when its key path yields an
	// invalid key, and the legacy migration copies old records in verbatim -- so a
	// store can hold rows the timestamp index cannot see. Counting the store and
	// trimming the index then disagree: the count says "over the cap", the trim
	// finds fewer and deletes nothing, and the prune runs again on the next vote
	// and the vote after that, forever. Asking the same question the trim will
	// answer is what makes the cheap path actually cheap.
	const total = await countRecords('voteHistory', TRIM_INDEX);
	if (total <= max) return;
	await trimRecords('voteHistory', TRIM_INDEX, max);
}

function readSnippet(thingEl: HTMLElement): string {
	// Comment: usertext-body .md; Post: title text.
	const md = thingEl.querySelector('.usertext-body .md');
	if (md instanceof HTMLElement && md.textContent) return md.textContent;
	const title = thingEl.querySelector('p.title a.title');
	if (title instanceof HTMLAnchorElement) return title.textContent || '';
	const currentTitle = thingEl.querySelector(getStableSelector('postTitleSlot', 'd2x'));
	if (currentTitle instanceof HTMLElement) return currentTitle.textContent || '';
	return '';
}

function readScore(thingEl: HTMLElement): number {
	const dataScore = thingEl.getAttribute('data-score') || thingEl.getAttribute('score');
	if (dataScore !== null && Number.isFinite(parseInt(dataScore, 10))) return parseInt(dataScore, 10);
	const score = thingEl.querySelector('.score.unvoted, .score.likes, .score.dislikes, .midcol .score');
	if (!(score instanceof HTMLElement)) return 0;
	const n = parseInt((score.textContent || '').replace(/[^\d-]/g, ''), 10);
	return Number.isFinite(n) ? n : 0;
}

async function recordVote(thingEl: HTMLElement, direction: VoteDirection): Promise<void> {
	if (module.options.recordVotes.value === false) return;
	const fullname = thingEl.getAttribute('data-fullname') || '';
	if (!fullname) return;
	const record = buildRecord({
		fullname,
		direction,
		subreddit: thingEl.getAttribute('data-subreddit') || '',
		author: thingEl.getAttribute('data-author') || '',
		permalink: thingEl.getAttribute('data-permalink') || '',
		body: readSnippet(thingEl),
		scoreAtTime: readScore(thingEl),
	});
	if (!record) return;
	try {
		await putRecord(record);
		await _pruneIfNeeded();
	} catch (err) { /* IDB unavailable — swallow */ }
}

function attachVoteListeners(thingEl: HTMLElement): void {
	if (thingEl.dataset.rsmVoteHistory === '1') return;
	thingEl.dataset.rsmVoteHistory = '1';
	const handler = (e: MouseEvent) => {
		const target = e.target;
		if (!(target instanceof HTMLElement)) return;
		const arrow = target.closest('.midcol .arrow');
		let direction: ?VoteDirection = null;
		if (arrow instanceof HTMLElement && arrow.classList.contains('up')) direction = arrow.classList.contains('upmod') ? 'unvote' : 'up';
		else if (arrow instanceof HTMLElement && arrow.classList.contains('down')) direction = arrow.classList.contains('downmod') ? 'unvote' : 'down';
		else {
			const action = (e: any).composedPath().find(node => node instanceof HTMLElement && node.hasAttribute('data-action-bar-action'));
			if (action instanceof HTMLElement) {
				const name = action.getAttribute('data-action-bar-action');
				if (name === 'upvote') direction = action.getAttribute('aria-pressed') === 'true' ? 'unvote' : 'up';
				if (name === 'downvote') direction = action.getAttribute('aria-pressed') === 'true' ? 'unvote' : 'down';
			}
		}
		if (!direction) return;
		recordVote(thingEl, direction);
	};
	thingEl.addEventListener('click', handler, true);
}

// The link used to download the whole log on the spot, which is the one thing
// you cannot undo a click of. It now opens the same records in the settings
// console, where they can be read and searched before any of them is exported.
function injectTrigger(): void {
	if (document.getElementById(TRIGGER_ID)) return;
	const userbar = appType() === 'd2x' ? findSurface('header', document, 'd2x') : findSurface('userbar');
	if (!(userbar instanceof HTMLElement)) return;
	const sep = document.createTextNode(' | ');
	const a = document.createElement('a');
	a.id = TRIGGER_ID;
	a.href = makeUrlHash(DATA_WORKSPACE_ROUTE);
	a.textContent = 'vote log';
	a.title = 'Browse and export the local vote history';
	userbar.append(sep, a);
}

module.contentStart = () => {
	watchForThings(['post', 'comment'], (thing: Thing) => {
		const el = thing.element;
		if (el instanceof HTMLElement) attachVoteListeners(el);
	});
	injectTrigger();
};

// internal export for the contract test
export const _internal = { classifyDirection, putRecord };
