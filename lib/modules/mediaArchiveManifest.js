/* @flow */
// RES-Slim: record every media download triggered from a reddit post into a
// local IndexedDB manifest. Subscribes to clicks on the known download-
// anchor selectors (downloadButtons, galleryZip, cobaltDownloader,
// localCompanion) and persists the URL + permalink + source + timestamp.
// Nothing leaves the browser.

import { Module } from '../core/module';
import { DATA_WORKSPACE_ROUTE } from '../constants/settingsCategories';
import { canPersistFeatureData } from '../environment';
import { readRecords, writeRecords } from '../environment/foreground/featureDb';
import {
	buildEntry,
	isDownloadAnchor,
} from '../utils/mediaManifest';
import type { MediaManifestEntry } from '../utils/mediaManifest';
import { makeUrlHash } from './settingsNavigation';

export const module: Module<{ [string]: any }> = new Module('mediaArchiveManifest');

module.moduleName = 'Media archive manifest';
module.category = 'productivityCategory';
module.description = 'Records every media download triggered from a reddit post (downloadButtons / galleryZip / cobalt / localCompanion) into a local IndexedDB manifest. Downloads from private windows are never recorded. Browsable + exportable. Nothing leaves the browser.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['media', 'manifest', 'archive', 'log', 'history', 'download'];

module.options = {
	maxEntries: {
		type: 'text',
		value: '20000',
		title: 'Max entries',
		description: 'Oldest entries dropped first once the cap is exceeded.',
	},
	trackHrefDownloads: {
		type: 'boolean',
		value: true,
		title: 'Track [download] anchors',
		description: 'Capture clicks on any anchor with the HTML `download` attribute, in addition to the known RES-Slim download buttons.',
	},
};

const TRIGGER_ID = 'rsm-mediaManifest-trigger';

// Kept in the extension's own database rather than reddit.com's, so the
// settings page can read the same manifest this module writes.
async function putEntry(entry: MediaManifestEntry): Promise<void> {
	if (!canPersistFeatureData('mediaArchiveManifest')) return;
	await writeRecords('mediaManifest', [entry]);
}

function allEntries(): Promise<MediaManifestEntry[]> {
	if (!canPersistFeatureData('mediaArchiveManifest')) return Promise.resolve([]);
	return readRecords('mediaManifest');
}

async function pruneIfNeeded(): Promise<void> {
	if (!canPersistFeatureData('mediaArchiveManifest')) return;
	const max = Math.max(100, parseInt(String(module.options.maxEntries.value || '20000'), 10) || 20000);
	const entries: MediaManifestEntry[] = await allEntries();
	if (entries.length <= max) return;
	entries.sort((a, b) => a.timestamp - b.timestamp);
	const toDelete = entries.slice(0, entries.length - max);
	await writeRecords('mediaManifest', [], toDelete.map(e => e.id));
}

function classifySource(anchor: HTMLElement): string {
	const cls = anchor.className || '';
	if (/rsm-cobalt-btn/.test(cls)) return 'cobalt';
	if (/rsm-localCompanion-btn/.test(cls)) return 'localCompanion';
	if (/rsm-galleryZip-btn/.test(cls)) return 'galleryZip';
	if (/RES-download/.test(cls)) return 'downloadButtons';
	return 'manual';
}

function recordFromClick(anchor: HTMLAnchorElement): void {
	if (!isDownloadAnchor(anchor)) return;
	const thing = anchor.closest('.thing');
	const url = anchor.href || anchor.getAttribute('href') || '';
	if (!url) return;
	const entry = buildEntry({
		url,
		filename: anchor.getAttribute('download') || '',
		postPermalink: thing instanceof HTMLElement ? thing.getAttribute('data-permalink') || '' : '',
		postFullname: thing instanceof HTMLElement ? thing.getAttribute('data-fullname') || '' : '',
		subreddit: thing instanceof HTMLElement ? thing.getAttribute('data-subreddit') || '' : '',
		source: classifySource(anchor),
	});
	if (!entry) return;
	putEntry(entry).then(() => pruneIfNeeded()).catch(() => { /* swallow */ });
}

// See the vote log: the link opens the manifest in the settings console rather
// than downloading the whole of it on the first click.
function injectTrigger(): void {
	if (document.getElementById(TRIGGER_ID)) return;
	const userbar = document.querySelector('#header-bottom-right');
	if (!(userbar instanceof HTMLElement)) return;
	const sep = document.createTextNode(' | ');
	const a = document.createElement('a');
	a.id = TRIGGER_ID;
	a.href = makeUrlHash(DATA_WORKSPACE_ROUTE);
	a.textContent = 'media log';
	a.title = 'Browse and export the local media-download manifest';
	userbar.append(sep, a);
}

module.contentStart = () => {
	// Capture clicks at the document level so we catch downloads regardless of
	// where the button lives. The handler bails fast if the anchor doesn't
	// match our download-button criteria.
	document.addEventListener('click', (e: MouseEvent) => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const anchor = target.closest('a');
		if (anchor instanceof HTMLAnchorElement) recordFromClick(anchor);
	}, true);
	injectTrigger();
};

export const _internal = { putEntry };
