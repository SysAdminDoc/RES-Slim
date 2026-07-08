/* @flow */
// RES-Slim: optional Cobalt API bridge. Adds a "Cobalt DL" button to posts
// whose data-domain matches a cobalt-supported host. Click POSTs the post
// URL to cobalt.tools (configurable instance), then triggers the browser's
// download for the returned tunnel/redirect/stream URL.
//
// Strictly opt-in. No external call fires without an explicit click.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { flashStatus } from '../utils/buttonStatus';
import {
	DEFAULT_HOSTS,
	buildRequestBody,
	isCobaltEligible,
	looksLikeStreamUrl,
	parseHostList,
	parseInstanceList,
} from '../utils/cobalt';
import { buildYtdlpBody, buildYtdlpUrl, isLocalhostUrl, looksLikeDownloadUrl } from '../utils/localCompanion';

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
		title: 'Cobalt instance URL(s)',
		description: 'Cobalt API base URL. The public instance is frequently degraded (and blocks YouTube), so you can list several comma- or newline-separated instances; they are tried in order until one responds.',
	},
	companionFallback: {
		type: 'boolean',
		value: false,
		title: 'Fall back to local companion',
		description: 'If every Cobalt instance fails, hand the download to a locally-run companion (yt-dlp) on localhost. Requires the localCompanion helper to be running.',
	},
	companionUrl: {
		type: 'text',
		value: 'http://127.0.0.1:7860',
		title: 'Local companion URL',
		description: 'Localhost-only base URL of the yt-dlp companion used for the fallback above.',
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
		description: 'Comma- or newline-separated additional domain substrings to mark cobalt-eligible. The default host list is always included; this option appends to it.',
	},
};

const BTN_CLASS = 'rsm-cobalt-btn';

function instancesFor(): string[] {
	return parseInstanceList(module.options.instance.value);
}

// Merge the frozen DEFAULT_HOSTS with any user-supplied additions. Earlier
// versions returned ONLY the user list when set, which silently dropped
// YouTube/Twitter/etc. — fixed in the v0.12 hardening pass.
function eligibleHosts(): string[] {
	const raw = String(module.options.customHosts.value || '').trim();
	if (!raw) return DEFAULT_HOSTS.slice();
	const extra = parseHostList(raw);
	const merged: Set<string> = new Set([...DEFAULT_HOSTS, ...extra]);
	return Array.from(merged);
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

// One instance attempt. Returns the parsed JSON on a usable response, or null
// when the instance is unreachable / errored so the caller can try the next.
async function postToInstance(instance: string, body: { [string]: mixed }): Promise<?Object> {
	let res;
	try {
		res = await fetch(instance, {
			method: 'POST',
			credentials: 'omit',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(body),
		});
	} catch (err) {
		return null;
	}
	if (!res.ok) return null;
	try {
		const data = await res.json();
		return data && typeof data === 'object' ? data : null;
	} catch (err) {
		return null;
	}
}

// Hand the download to a locally-run yt-dlp companion when Cobalt is unavailable.
async function tryCompanionFallback(targetUrl: string, button: HTMLAnchorElement, restoreText: string): Promise<boolean> {
	if (module.options.companionFallback.value !== true) return false;
	const base = String(module.options.companionUrl.value || '');
	if (!isLocalhostUrl(base)) return false;
	flashStatus(button, 'trying local companion…');
	try {
		const res = await fetch(buildYtdlpUrl(base), {
			method: 'POST',
			credentials: 'omit',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(buildYtdlpBody(targetUrl, {
				format: String(module.options.videoQuality.value || '1080'),
				audioOnly: module.options.downloadMode.value === 'audio',
			})),
		});
		if (!res.ok) { flashStatus(button, `companion: HTTP ${res.status}`, { restore: restoreText, durationMs: 5000 }); return true; }
		const data: any = await res.json();
		if (data && looksLikeDownloadUrl(data.url)) {
			triggerDownload(data.url, data.filename || '');
			flashStatus(button, '✓ companion', { restore: restoreText, durationMs: 5000 });
		} else {
			flashStatus(button, data && data.ok ? '✓ companion (queued)' : 'companion: no file', { restore: restoreText, durationMs: 5000 });
		}
	} catch (err) {
		flashStatus(button, 'companion: unreachable', { restore: restoreText, durationMs: 5000 });
	}
	return true;
}

async function requestCobalt(targetUrl: string, button: HTMLAnchorElement, restoreText: string): Promise<void> {
	const body = buildRequestBody({
		url: targetUrl,
		videoQuality: String(module.options.videoQuality.value || '1080'),
		audioFormat: String(module.options.audioFormat.value || 'best'),
		downloadMode: String(module.options.downloadMode.value || 'auto'),
		filenameStyle: 'pretty',
	});

	const instances = instancesFor();
	let data = null;
	for (let i = 0; i < instances.length; i++) {
		if (instances.length > 1) flashStatus(button, `cobalt: trying ${i + 1}/${instances.length}…`);
		data = await postToInstance(instances[i], body);
		if (data) break;
	}

	if (!data) {
		if (await tryCompanionFallback(targetUrl, button, restoreText)) return;
		flashStatus(button, 'cobalt: all instances failed', { restore: restoreText, durationMs: 5000 });
		return;
	}

	const kind: any = (data: any).status;
	if (kind === 'tunnel' || kind === 'redirect' || kind === 'stream' || kind === 'local-processing') {
		const url = (data: any).url;
		if (!looksLikeStreamUrl(url)) {
			flashStatus(button, 'cobalt: invalid URL', { restore: restoreText, durationMs: 5000 });
			return;
		}
		triggerDownload(url, (data: any).filename || '');
		flashStatus(button, `✓ ${kind}`, { restore: restoreText, durationMs: 5000 });
		return;
	}
	if (kind === 'picker') {
		const picker = (data: any).picker;
		if (Array.isArray(picker) && picker.length) {
			let triggered = 0;
			for (const item of picker) {
				if (item && looksLikeStreamUrl(item.url)) {
					triggerDownload(item.url, '');
					triggered += 1;
				}
			}
			flashStatus(button, triggered ? `✓ picker (${triggered})` : 'cobalt: empty picker', { restore: restoreText, durationMs: 5000 });
		} else {
			flashStatus(button, 'cobalt: empty picker', { restore: restoreText, durationMs: 5000 });
		}
		return;
	}
	if (kind === 'error') {
		// A Cobalt error (e.g. YouTube blocked on the public instance) is exactly
		// when the local companion earns its keep — offer it before giving up.
		if (await tryCompanionFallback(targetUrl, button, restoreText)) return;
		const code = (data: any).error && (data: any).error.code;
		flashStatus(button, `cobalt error: ${code || 'unknown'}`, { restore: restoreText, durationMs: 5000 });
		return;
	}
	flashStatus(button, `cobalt: ${String(kind)}`, { restore: restoreText, durationMs: 5000 });
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

	const restoreText = a.textContent;
	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		flashStatus(a, 'sending…');
		try {
			await requestCobalt(url, a, restoreText);
		} catch (err) {
			// requestCobalt handles its own surface; anything escaping here is a
			// programming error we still want to surface non-silently.
			flashStatus(a, 'cobalt: unexpected error', { restore: restoreText, durationMs: 5000 });
		}
	});
}

function process(thing: Thing): void {
	const el = thing.element;
	if (el instanceof HTMLElement) injectButton(el);
}

module.contentStart = () => {
	watchForThings(['post'], process);
};
