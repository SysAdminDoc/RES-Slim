/* @flow */
// RES-Slim: optional local-companion bridge. Talks to a user-run helper on
// 127.0.0.1 that wraps yt-dlp / ffmpeg / ollama for the long tail of media
// hosts the extension can't reach via cobalt. Strictly opt-in, localhost-
// only, explicit URL + health check. Nothing fires without an explicit
// click except the documented `health` ping when the user runs the action.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { flashStatus } from '../utils/buttonStatus';
import {
	buildHealthUrl,
	buildYtdlpUrl,
	buildYtdlpBody,
	isLocalhostUrl,
	parseHealth,
	sanitizeCompanionUrl,
} from '../utils/localCompanion';

export const module: Module<*> = new Module('localCompanion');

module.moduleName = 'Local companion (yt-dlp / ffmpeg / ollama)';
module.category = 'productivityCategory';
module.description = 'Optional localhost-only bridge to a user-run helper service that wraps yt-dlp, ffmpeg, and ollama. Adds a `local DL` button next to posts. The bridge URL must be localhost (127.0.0.1 or localhost) — any other origin is rejected.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['ytdlp', 'ffmpeg', 'ollama', 'companion', 'local', 'download'];

module.options = {
	companionUrl: {
		type: 'text',
		value: 'http://127.0.0.1:7860',
		title: 'Companion base URL',
		description: 'Localhost-only. Defaults to http://127.0.0.1:7860 (matches the example helper). Non-localhost URLs are rejected at runtime.',
	},
	ytdlpFormat: {
		type: 'enum',
		value: 'best',
		title: 'yt-dlp format string',
		values: [
			{ name: 'best', value: 'best' },
			{ name: 'bestvideo+bestaudio (mp4 mux)', value: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4' },
			{ name: 'bestvideo[height<=1080]+bestaudio', value: 'bestvideo[height<=1080]+bestaudio' },
			{ name: 'bestaudio (audio only)', value: 'bestaudio' },
		],
		description: 'Passed straight through to yt-dlp\'s `-f` flag. Power users can pick a stricter selector.',
	},
	audioOnly: {
		type: 'boolean',
		value: false,
		title: 'Audio-only',
		description: 'Tell yt-dlp to extract audio. Most companions infer the right output extension from --extract-audio.',
	},
	showHealth: {
		type: 'boolean',
		value: true,
		title: 'Show health badge in the toolbar',
		description: 'Adds a tiny pill next to the gear icon indicating whether the companion is reachable. Refreshes when the module starts.',
	},
};

const BTN_CLASS = 'rsm-localCompanion-btn';
const HEALTH_BADGE_ID = 'rsm-localCompanion-health';

function instanceFor(): string {
	return sanitizeCompanionUrl(module.options.companionUrl.value);
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

async function refreshHealthBadge(): Promise<void> {
	if (module.options.showHealth.value === false) return;
	const userbar = document.querySelector('#header-bottom-right');
	if (!(userbar instanceof HTMLElement)) return;
	let badge = document.getElementById(HEALTH_BADGE_ID);
	if (!(badge instanceof HTMLElement)) {
		badge = document.createElement('span');
		badge.id = HEALTH_BADGE_ID;
		badge.textContent = '·';
		userbar.append(' ', badge);
	}
	const base = instanceFor();
	if (!isLocalhostUrl(base)) {
		badge.textContent = '!';
		badge.title = 'Companion URL must be localhost';
		badge.dataset.state = 'invalid';
		return;
	}
	try {
		const res = await fetch(buildHealthUrl(base), { credentials: 'omit', method: 'GET' });
		const health = res.ok ? parseHealth(await res.json()) : { ok: false };
		if (health.ok) {
			badge.textContent = '✓';
			badge.title = `Companion online (yt-dlp: ${health.ytdlp ? 'yes' : 'no'}, ffmpeg: ${health.ffmpeg ? 'yes' : 'no'}, ollama: ${health.ollama ? 'yes' : 'no'})`;
			badge.dataset.state = 'ok';
		} else {
			badge.textContent = '×';
			badge.title = 'Companion responded but reports not-ok';
			badge.dataset.state = 'err';
		}
	} catch (err) {
		badge.textContent = '×';
		badge.title = 'Companion unreachable';
		badge.dataset.state = 'down';
	}
}

async function requestYtdlp(targetUrl: string, button: HTMLAnchorElement, restoreText: string): Promise<void> {
	const base = instanceFor();
	if (!isLocalhostUrl(base)) {
		flashStatus(button, 'companion: not localhost', { restore: restoreText, durationMs: 5000 });
		return;
	}
	const body = buildYtdlpBody(targetUrl, {
		format: String(module.options.ytdlpFormat.value || 'best'),
		audioOnly: module.options.audioOnly.value === true,
	});

	let res;
	try {
		res = await fetch(buildYtdlpUrl(base), {
			method: 'POST',
			credentials: 'omit',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(body),
		});
	} catch (err) {
		flashStatus(button, 'companion: unreachable', { restore: restoreText, durationMs: 5000 });
		return;
	}
	if (!res.ok) {
		flashStatus(button, `companion: HTTP ${res.status}`, { restore: restoreText, durationMs: 5000 });
		return;
	}

	let data;
	try { data = await res.json(); }
	catch (err) {
		flashStatus(button, 'companion: non-JSON response', { restore: restoreText, durationMs: 5000 });
		return;
	}
	if (!data || typeof data !== 'object') {
		flashStatus(button, 'companion: bad response', { restore: restoreText, durationMs: 5000 });
		return;
	}
	const url = (data: any).url;
	if (typeof url !== 'string') {
		flashStatus(button, 'companion: no url', { restore: restoreText, durationMs: 5000 });
		return;
	}
	triggerDownload(url, (data: any).filename || '');
	flashStatus(button, '✓ local DL', { restore: restoreText, durationMs: 5000 });
}

function injectButton(thingEl: HTMLElement): void {
	const url = thingEl.getAttribute('data-url') || '';
	if (!url) return;
	const buttons = thingEl.querySelector(':scope > .entry ul.flat-list.buttons');
	if (!(buttons instanceof HTMLElement)) return;
	if (buttons.querySelector(`.${BTN_CLASS}`)) return;
	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = BTN_CLASS;
	a.textContent = 'local DL';
	a.title = 'Hand this URL to the local companion (yt-dlp)';
	li.append(a);
	buttons.append(li);

	const restoreText = a.textContent;
	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		flashStatus(a, 'sending…');
		try {
			await requestYtdlp(url, a, restoreText);
		} catch (err) {
			flashStatus(a, 'companion: unexpected error', { restore: restoreText, durationMs: 5000 });
		}
	});
}

function process(thing: Thing): void {
	const el = thing.element;
	if (el instanceof HTMLElement) injectButton(el);
}

module.contentStart = async () => {
	watchForThings(['post'], process);
	await refreshHealthBadge();
};
