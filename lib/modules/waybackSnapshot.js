/* @flow */
// RES-Slim: snapshot-now button. Adds a `archive` link to every post that
// checks the current Wayback availability and offers to trigger a fresh
// snapshot if one is older than the configured staleness threshold.
//
// Pairs with the existing `archiveLinks` module (which links to existing
// snapshots) — this one CREATES snapshots.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import {
	buildAvailabilityUrl,
	buildSaveUrl,
	formatTimestamp,
	parseAvailabilityResponse,
} from '../utils/wayback';

export const module: Module<*> = new Module('waybackSnapshot');

module.moduleName = 'Wayback snapshot-now';
module.category = 'productivityCategory';
module.description = 'Adds a `archive` link to posts. Checks the Wayback Machine for an existing snapshot; offers to trigger a fresh save if none is recent enough. External integration — defaults off.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['wayback', 'archive', 'snapshot', 'preservation', 'save'];

module.options = {
	mode: {
		type: 'enum',
		value: 'manual',
		title: 'Behaviour',
		values: [
			{ name: 'Manual — show the button, no auto-save', value: 'manual' },
			{ name: 'Check availability on click, save if stale', value: 'check' },
			{ name: 'Always trigger a fresh save', value: 'force' },
		],
		description: 'Manual just opens the save page in a new tab. Check fetches availability first and only saves if no snapshot exists within the staleness window. Force always saves.',
	},
	stalenessDays: {
		type: 'text',
		value: '90',
		title: 'Snapshot staleness (days)',
		description: 'Snapshots older than this trigger a fresh save in "check" mode. Default 90.',
	},
	target: {
		type: 'enum',
		value: 'permalink',
		title: 'Snapshot target',
		values: [
			{ name: 'Reddit permalink', value: 'permalink' },
			{ name: 'Linked URL (data-url)', value: 'dataUrl' },
			{ name: 'Both (two saves)', value: 'both' },
		],
		description: 'Which URL to send to Wayback. Snapshotting the permalink preserves the discussion; the data-url preserves the linked article.',
	},
};

const limiter = createRateLimiter({ tokens: 3, refillMs: 2000, maxConcurrent: 2 });
const BTN_CLASS = 'rsm-waybackSnapshot-btn';

function thingTargets(thingEl: HTMLElement): string[] {
	const mode = String(module.options.target.value || 'permalink');
	const out: string[] = [];
	if (mode === 'permalink' || mode === 'both') {
		const perma = thingEl.getAttribute('data-permalink');
		if (perma) out.push(`https://old.reddit.com${perma}`);
	}
	if (mode === 'dataUrl' || mode === 'both') {
		const dataUrl = thingEl.getAttribute('data-url');
		if (dataUrl) out.push(dataUrl);
	}
	return out;
}

function stalenessMs(): number {
	const days = parseInt(String(module.options.stalenessDays.value || '90'), 10);
	if (!Number.isFinite(days) || days <= 0) return 90 * 24 * 60 * 60 * 1000;
	return days * 24 * 60 * 60 * 1000;
}

function tsToDate(ts: string): ?Date {
	const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
	if (!m) return null;
	return new Date(Date.UTC(
		parseInt(m[1], 10),
		parseInt(m[2], 10) - 1,
		parseInt(m[3], 10),
		parseInt(m[4], 10),
		parseInt(m[5], 10),
		parseInt(m[6], 10),
	));
}

async function checkAvailability(url: string): Promise<?{ url: string, timestamp: string, isStale: boolean }> {
	const u = buildAvailabilityUrl(url);
	try {
		const data = await limiter.schedule(async () => {
			const res = await fetch(u, { credentials: 'omit', headers: { Accept: 'application/json' } });
			if (!res.ok) throw new Error(`status ${res.status}`);
			return res.json();
		});
		const parsed = parseAvailabilityResponse(data);
		if (!parsed || !parsed.available) return null;
		const when = tsToDate(parsed.timestamp);
		const stale = !when || (Date.now() - when.getTime() > stalenessMs());
		return { url: parsed.url, timestamp: parsed.timestamp, isStale: stale };
	} catch (e) {
		return null;
	}
}

function openSave(url: string): void {
	window.open(buildSaveUrl(url), '_blank', 'noopener,noreferrer');
}

function openSnapshot(url: string): void {
	window.open(url, '_blank', 'noopener,noreferrer');
}

async function performAction(targets: string[], status: HTMLAnchorElement): Promise<void> {
	const mode = String(module.options.mode.value || 'manual');
	if (!targets.length) {
		status.textContent = 'no URL';
		return;
	}
	if (mode === 'manual') {
		for (const t of targets) openSave(t);
		status.textContent = '✓ opened';
		return;
	}
	if (mode === 'force') {
		for (const t of targets) openSave(t);
		status.textContent = '✓ saving';
		return;
	}
	// check
	for (const target of targets) {
		const avail = await checkAvailability(target);
		if (!avail) {
			openSave(target);
			continue;
		}
		if (avail.isStale) {
			openSave(target);
		} else {
			openSnapshot(avail.url);
		}
	}
	status.textContent = '✓ checked';
}

function injectButton(thingEl: HTMLElement): void {
	const buttons = thingEl.querySelector(':scope > .entry ul.flat-list.buttons');
	if (!(buttons instanceof HTMLElement)) return;
	if (buttons.querySelector(`.${BTN_CLASS}`)) return;
	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = BTN_CLASS;
	a.textContent = 'archive';
	a.title = 'Snapshot via Wayback Machine';
	li.append(a);
	buttons.append(li);

	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		const original = a.textContent || 'archive';
		a.textContent = '…';
		try {
			await performAction(thingTargets(thingEl), a);
		} catch (err) {
			a.textContent = 'archive failed';
		}
		const last = a.textContent;
		setTimeout(() => { a.textContent = original; a.title = last ? `Last: ${last}` : a.title; }, 5000);
	});
}

function process(thing: Thing): void {
	const el = thing.element;
	if (el instanceof HTMLElement) injectButton(el);
}

module.contentStart = () => {
	watchForThings(['post'], process);
};

// Exposed for the contract test.
export const _internal = { formatTimestamp };
