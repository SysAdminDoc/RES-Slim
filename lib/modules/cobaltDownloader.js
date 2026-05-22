/* @flow */
// RES-Slim: optional Cobalt API bridge. Adds a "Cobalt DL" button to posts
// whose data-domain matches a cobalt-supported host. Click POSTs the post
// URL to cobalt.tools (configurable instance), then triggers the browser's
// download for the returned tunnel/redirect/stream URL.
//
// Strictly opt-in. No external call fires without an explicit click.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import {
	buildRequestBody,
	isCobaltEligible,
	looksLikeStreamUrl,
	parseHostList,
	sanitizeInstance,
} from '../utils/cobalt';

export const module: Module<*> = new Module('cobaltDownloader');

module.moduleName = 'Cobalt API bridge';
module.category = 'productivityCategory';
module.description = 'Optional Cobalt API integration. Adds a "Cobalt DL" button to posts on supported hosts (YouTube, TikTok, Twitter, etc.). Strictly opt-in: no request fires without an explicit click. Configure the instance URL to point at any cobalt-compatible deployment.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['cobalt', 'download', 'video', 'youtube', 'tiktok', 'twitter'];

module.options = {
	instance: {
		type: 'text',
		value: 'https://api.cobalt.tools',
		title: 'Cobalt instance URL',
		description: 'Cobalt API base URL. Default is the public instance; self-hosted deployments are supported.',
	},
	videoQuality: {
		type: 'enum',
		value: '1080',
		title: 'Video quality',
		values: [
			{ name: '360p', value: '360' },
			{ name: '480p', value: '480' },
			{ name: '720p', value: '720' },
			{ name: '1080p', value: '1080' },
			{ name: '1440p', value: '1440' },
			{ name: '2160p (4K)', value: '2160' },
			{ name: 'Maximum available', value: 'max' },
		],
		description: 'Preferred video quality. Falls back to the next-lower if unavailable.',
	},
	audioFormat: {
		type: 'enum',
		value: 'best',
		title: 'Audio format',
		values: [
			{ name: 'Best (host default)', value: 'best' },
			{ name: 'MP3', value: 'mp3' },
			{ name: 'Opus', value: 'opus' },
			{ name: 'M4A', value: 'm4a' },
			{ name: 'WAV', value: 'wav' },
		],
		description: 'Audio container/codec for audio-only downloads.',
	},
	downloadMode: {
		type: 'enum',
		value: 'auto',
		title: 'Download mode',
		values: [
			{ name: 'Auto (video + audio)', value: 'auto' },
			{ name: 'Audio only', value: 'audio' },
			{ name: 'Mute (video only)', value: 'mute' },
		],
		description: 'auto bundles audio and video; audio drops video; mute drops audio.',
	},
	customHosts: {
		type: 'text',
		value: '',
		title: 'Additional hosts',
		description: 'Comma- or newline-separated additional domain substrings to mark cobalt-eligible. Useful when running a self-hosted instance that supports more hosts.',
	},
};

const BTN_CLASS = 'rsm-cobalt-btn';

function instanceFor(): string {
	return sanitizeInstance(module.options.instance.value);
}

function eligibleHosts(): string[] {
	const extra = parseHostList(module.options.customHosts.value);
	// parseHostList returns DEFAULT_HOSTS when empty — the union with that set
	// IS the full DEFAULT list when `customHosts` is empty.
	return extra;
}

function triggerDownload(url: string, filename: string): void {
	const a = document.createElement('a');
	a.href = url;
	a.download = filename || '';
	a.rel = 'noopener noreferrer';
	document.body.append(a);
	a.click();
	setTimeout(() => { a.remove(); }, 1500);
}

async function requestCobalt(targetUrl: string, status: HTMLAnchorElement): Promise<void> {
	const instance = instanceFor();
	const body = buildRequestBody({
		url: targetUrl,
		videoQuality: String(module.options.videoQuality.value || '1080'),
		audioFormat: String(module.options.audioFormat.value || 'best'),
		downloadMode: String(module.options.downloadMode.value || 'auto'),
		filenameStyle: 'pretty',
	});
	const res = await fetch(instance, {
		method: 'POST',
		credentials: 'omit',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		status.textContent = `Cobalt: ${res.status}`;
		return;
	}
	const data = await res.json();
	if (!data || typeof data !== 'object') {
		status.textContent = 'Cobalt: bad response';
		return;
	}
	const kind: any = (data: any).status;
	if (kind === 'tunnel' || kind === 'redirect' || kind === 'stream' || kind === 'local-processing') {
		const url = (data: any).url;
		if (!looksLikeStreamUrl(url)) {
			status.textContent = 'Cobalt: no URL';
			return;
		}
		triggerDownload(url, (data: any).filename || '');
		status.textContent = `✓ ${kind}`;
	} else if (kind === 'picker') {
		const picker = (data: any).picker;
		if (Array.isArray(picker) && picker.length) {
			for (const item of picker) {
				if (item && typeof item.url === 'string') triggerDownload(item.url, '');
			}
			status.textContent = `✓ picker (${picker.length})`;
		} else {
			status.textContent = 'Cobalt: empty picker';
		}
	} else if (kind === 'error') {
		const code = (data: any).error && (data: any).error.code;
		status.textContent = `Cobalt error: ${code || 'unknown'}`;
	} else {
		status.textContent = `Cobalt: ${String(kind)}`;
	}
}

function injectButton(thingEl: HTMLElement): void {
	const url = thingEl.getAttribute('data-url') || '';
	const domain = thingEl.getAttribute('data-domain') || '';
	if (!url || !domain) return;
	if (!isCobaltEligible(domain, eligibleHosts())) return;
	const buttons = thingEl.querySelector(':scope > .entry ul.flat-list.buttons');
	if (!(buttons instanceof HTMLElement)) return;
	if (buttons.querySelector(`.${BTN_CLASS}`)) return;
	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = BTN_CLASS;
	a.textContent = 'cobalt';
	a.title = 'Download via cobalt.tools';
	li.append(a);
	buttons.append(li);

	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		const original = a.textContent || 'cobalt';
		a.textContent = 'sending…';
		try {
			await requestCobalt(url, a);
		} catch (err) {
			a.textContent = `cobalt: ${String((err && (err: any).message) || 'fail')}`;
		}
		setTimeout(() => { a.textContent = original; }, 5000);
	});
}

function process(thing: Thing): void {
	const el = thing.element;
	if (el instanceof HTMLElement) injectButton(el);
}

module.contentStart = () => {
	watchForThings(['post'], process);
};
