/* @flow */
// RES-Slim: local-only vote/read history log. Every up/downvote the user
// casts on old.reddit is recorded to IndexedDB along with a snippet and the
// score-at-time. Nothing leaves the browser. Browseable from the userbar
// `vote log` link; exportable as JSON or CSV.

import { Module } from '../core/module';
import { findSurface, getStableSelector } from '../core/dom/selectors';
import { DATA_WORKSPACE_ROUTE } from '../constants/settingsCategories';
import { canPersistFeatureData } from '../environment';
import { readRecords, writeRecords } from '../environment/foreground/featureDb';
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
async function putRecord(record: VoteRecord): Promise<void> {
	if (!canPersistFeatureData('voteHistory')) return;
	await writeRecords('voteHistory', [record]);
}

function allRecords(): Promise<VoteRecord[]> {
	if (!canPersistFeatureData('voteHistory')) return Promise.resolve([]);
	return readRecords('voteHistory');
}

async function pruneIfNeeded(): Promise<void> {
	if (!canPersistFeatureData('voteHistory')) return;
	const max = Math.max(100, parseInt(String(module.options.maxRecords.value || '50000'), 10) || 50000);
	const records: VoteRecord[] = await allRecords();
	if (records.length <= max) return;
	records.sort((a, b) => a.timestamp - b.timestamp);
	const toDelete = records.slice(0, records.length - max);
	await writeRecords('voteHistory', [], toDelete.map(r => r.id));
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
		await pruneIfNeeded();
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
