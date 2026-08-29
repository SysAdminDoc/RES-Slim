/* @flow */
// RES-Slim: overwrite and delete your own comments in bulk.
//
// This is the biggest hole in the old.reddit userscript ecosystem — the "Reddit
// Secure Delete" / "Reddit Overwrite" / "Spaz's Reddit Delete" / "Reddit History
// Sanitizer" family has more installs between them than any other category — and
// it is also the one place in this extension where a mistake cannot be undone.
// Everything below is shaped by that.
//
//   * The module is off by default and only builds its control on your own
//     profile's comments page. There is no keyboard route and no menu entry.
//   * Nothing runs without a plan first. The first click always produces a
//     preview: how many comments match, in which subreddits, oldest and newest,
//     and how many were skipped and why. `dryRun` starts on.
//   * The destructive click requires typing the word DELETE. The repo's usual
//     "no confirmation dialogs" rule is about reversible actions — hideAll offers
//     Undo instead of a prompt because /api/unhide exists. Nothing un-deletes a
//     comment, so this one asks.
//   * Overwrite happens before delete and is confirmed per comment. Deleting
//     without overwriting leaves the text in every archive that scraped it; that
//     is the entire point of the userscripts this replaces.
//   * An empty filter set selects nothing, never everything.
//
// Selection logic and the listing parser are pure and unit-tested in
// lib/utils/commentShredder.js.

import { Module } from '../core/module';
import { ajax } from '../environment';
import { sendMessage } from '../environment/foreground/messaging';
import { currentUserProfile, isPageType, loggedInUser, loggedInUserHash, string } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import { SHRED_LEASE_HEARTBEAT_MS, ownerMessage } from '../utils/shredLease';
import {
	DEFAULT_OVERWRITE_TEXT,
	overwriteBody,
	parseListing,
	parseSubredditList,
	planShred,
	summariseOutcome,
} from '../utils/commentShredder';
import { showNotification } from './notifications';

export const module: Module<{ [string]: any }> = new Module('commentShredder');

module.moduleName = 'Shred my comments';
module.category = 'myAccountCategory';
module.description = 'Bulk-overwrite and then delete your own old comments, filtered by age, score and subreddit. Adds a control to your own profile\'s comments page. Every run previews what it would touch before anything is changed, and deleting requires a typed confirmation. None of it can be undone.';
module.descriptionRaw = true;
module.include = ['profile'];
module.disabledByDefault = true;
module.keywords = ['delete', 'shred', 'overwrite', 'scrub', 'privacy', 'history', 'comments'];

module.options = {
	dryRun: {
		type: 'boolean',
		value: true,
		title: 'Preview only (dry run)',
		description: 'Leave this on until the preview shows exactly what you expect. With it on, no edit or delete request is ever sent.',
	},
	olderThanDays: {
		type: 'text',
		value: '365',
		title: 'Only comments older than (days)',
		description: 'Anything more recent is skipped. Set to 0 to include everything, which is rarely what you want.',
	},
	subredditMode: {
		type: 'enum',
		value: 'deny',
		values: [
			{ name: 'Everywhere except the subreddits listed below', value: 'deny' },
			{ name: 'Only the subreddits listed below', value: 'allow' },
		],
		title: 'Subreddit filter',
		description: 'The allow mode deliberately selects nothing while the list is empty, so a half-filled setting can\'t delete your whole history.',
	},
	subreddits: {
		type: 'text',
		value: '',
		title: 'Subreddit list',
		description: 'Comma- or space-separated. <code>r/</code> prefixes are fine.',
	},
	keepScoreAtOrAbove: {
		type: 'text',
		value: '',
		title: 'Keep comments scoring at least',
		description: 'Leave empty to ignore score. A value like 50 keeps the comments people actually found useful.',
	},
	keepGilded: {
		type: 'boolean',
		value: true,
		title: 'Keep awarded comments',
		description: 'Skips anything gilded or awarded.',
	},
	overwriteText: {
		type: 'text',
		value: '',
		title: 'Overwrite text',
		description: 'Leave empty for generated filler that differs per comment. Use <code>{n}</code> anywhere in your own text to get the same effect. Reddit silently drops an edit whose body matches the previous one.',
	},
	deleteAfterOverwrite: {
		type: 'boolean',
		value: true,
		title: 'Delete after overwriting',
		description: 'Turn this off to overwrite only, which leaves the comment in place with its content replaced.',
	},
	maxPerRun: {
		type: 'text',
		value: '100',
		title: 'Maximum per run',
		description: 'A hard ceiling on how many comments one run may touch, so a mistaken filter costs a hundred comments rather than ten thousand.',
	},
	requestsPerSecond: {
		type: 'enum',
		value: '1',
		values: [
			{ name: 'Gentle (1 per second)', value: '1' },
			{ name: 'Normal (2 per second)', value: '2' },
		],
		title: 'Request rate',
		description: 'Reddit rate-limits writes hard. Two per second is already near the ceiling for a normal account.',
	},
};

const LINK_CLASS = 'rsm-commentShredder-link';

// One run at a time per tab. Two runs over the same account always overlap in
// the way that matters: they share reddit's per-account write limiter, and the
// second tries to delete comments the first has already deleted — turning a
// normal outcome into a page of failures the summary then reports as untouched.
//
// This boolean only ever saw its own tab, which is the case that matters least:
// the panel is rebuilt on every use, so the same tab already had to click twice.
// `accountLease` below is the part that sees the other tab, and the other
// renderer — old Reddit and current Reddit are different origins, so nothing on
// the page can be the shared authority.
let runInFlight = false;

// Why the run did not start, in the panel's own voice. Two of these are not
// "somebody else is running" and must not say so: an unknown account and an
// unreachable background are both this tab's problem to fix.
function refusalMessage(grant: *): string {
	const reason = grant && grant.reason;
	if (reason === 'no-account') return 'Could not tell which account this is, so nothing was started. Reload the page and try again.';
	if (reason === 'unreachable') return 'Could not check whether another run is going, so nothing was started. Reload the page and try again.';
	return ownerMessage(grant && grant.owner);
}

// Bound to one account, so the panel never has to know how the lease is keyed.
function accountLease(account: string) {
	let token = null;
	const send = (operation, extra) => sendMessage('shredLease', { operation, account, token, ...extra });
	return {
		async acquire() {
			const result = await send('acquire', { state: 'running' });
			if (result && result.ok) token = result.token;
			return result;
		},
		async renew(state: string) {
			const result = await send('renew', { state });
			// A lost lease is not recoverable by renewing harder: the account is
			// somebody else's now, and the caller has to stop.
			return !!(result && result.ok);
		},
		async release() {
			if (!token) return;
			await send('release', {});
			token = null;
		},
	};
}
const PAGE_SIZE = 100;
// Reddit caps listing pagination at 1000 items regardless of `after`.
const MAX_PAGES = 10;

function shredOptions() {
	const olderThanDays = parseFloat(module.options.olderThanDays.value);
	const keepScoreRaw = String(module.options.keepScoreAtOrAbove.value || '').trim();
	const keepScore = keepScoreRaw === '' ? null : parseInt(keepScoreRaw, 10);
	const maxPerRun = parseInt(module.options.maxPerRun.value, 10);

	return {
		olderThanDays: Number.isFinite(olderThanDays) ? olderThanDays : 365,
		subredditMode: module.options.subredditMode.value === 'allow' ? 'allow' : 'deny',
		subreddits: parseSubredditList(module.options.subreddits.value),
		keepScoreAtOrAbove: Number.isFinite(keepScore) ? keepScore : null,
		keepGilded: module.options.keepGilded.value === true,
		maxPerRun: Number.isFinite(maxPerRun) && maxPerRun > 0 ? maxPerRun : 100,
	};
}

async function fetchAllComments(username: string, limiter: *): Promise<*> {
	const items = [];
	let after = null;

	let page = 0;
	while (page < MAX_PAGES) {
		page++;
		const query: { [string]: string } = { limit: String(PAGE_SIZE), raw_json: '1' };
		if (after) query.after = after;

		// eslint-disable-next-line no-await-in-loop
		const json = await limiter.schedule(() => ajax({
			url: `/user/${username}/comments.json`,
			query,
			type: 'json',
		}));

		const parsed = parseListing(json);
		items.push(...parsed.items);
		after = parsed.after;
		if (!after || !parsed.items.length) break;
	}

	return items;
}

function summarise(plan: *, total: number): HTMLElement {
	const wrapper = document.createElement('div');

	const counts = new Map();
	let oldest = Infinity;
	let newest = 0;
	for (const decision of plan.selected) {
		const sub = decision.item.subreddit || '(unknown)';
		counts.set(sub, (counts.get(sub) || 0) + 1);
		oldest = Math.min(oldest, decision.item.createdUtc);
		newest = Math.max(newest, decision.item.createdUtc);
	}

	const head = document.createElement('p');
	head.style.margin = '0 0 8px';
	head.textContent = `${plan.selected.length} of ${total} fetched comments match. ${plan.skipped.length} skipped.`;
	wrapper.append(head);

	if (plan.selected.length) {
		const range = document.createElement('p');
		range.style.margin = '0 0 8px';
		range.textContent = `Oldest ${new Date(oldest * 1000).toLocaleDateString()}, newest ${new Date(newest * 1000).toLocaleDateString()}.`;
		wrapper.append(range);

		const list = document.createElement('ul');
		list.style.margin = '0 0 8px 16px';
		for (const [sub, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
			const li = document.createElement('li');
			li.textContent = `r/${sub}: ${n}`;
			list.append(li);
		}
		if (counts.size > 8) {
			const li = document.createElement('li');
			li.textContent = `…and ${counts.size - 8} more subreddits`;
			list.append(li);
		}
		wrapper.append(list);
	}

	if (plan.cappedAt) {
		const capped = document.createElement('p');
		capped.style.margin = '0 0 8px';
		capped.textContent = `Capped at ${plan.cappedAt} per run. Run again to continue.`;
		wrapper.append(capped);
	}

	return wrapper;
}

// The typed confirmation. Deliberately not a browser confirm(): that is modal to
// the whole tab and its text cannot show the plan the user is agreeing to.
// Exported for the contract: the progress surface and the Stop button are the
// feature, and neither is observable from `execute`.
export function confirmPanel(count: number, onConfirm: (controls: *) => void, lease: *): HTMLElement {
	const wrapper = document.createElement('div');

	const warning = document.createElement('p');
	warning.style.margin = '0 0 8px';
	warning.style.fontWeight = '600';
	warning.textContent = `This will overwrite and delete ${count} comment${count === 1 ? '' : 's'}. It cannot be undone.`;
	wrapper.append(warning);

	const label = document.createElement('label');
	label.style.display = 'block';
	label.style.marginBottom = '8px';
	label.textContent = 'Type DELETE to confirm: ';

	const input = document.createElement('input');
	input.type = 'text';
	input.autocomplete = 'off';
	input.setAttribute('aria-label', 'Type DELETE to confirm');
	input.style.marginLeft = '6px';
	label.append(input);
	wrapper.append(label);

	const go = document.createElement('button');
	go.type = 'button';
	go.className = 'RESNotificationButtonBlue';
	go.textContent = 'Shred';
	go.disabled = true;
	input.addEventListener('input', () => { go.disabled = input.value.trim() !== 'DELETE'; });

	// Live progress + a way out. `execute` runs one request at a time at
	// 1-2/second with a default cap of 100, so a normal run is a minute or more of
	// irreversible work. "Shredding…" on a static button is not enough feedback for
	// that, and there was previously no way to stop it once started.
	const status = document.createElement('p');
	status.style.margin = '8px 0 0';
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	status.hidden = true;

	const stop = document.createElement('button');
	stop.type = 'button';
	stop.className = 'RESNotificationButtonBlue';
	stop.textContent = 'Stop';
	stop.style.marginLeft = '6px';
	stop.hidden = true;

	let stopRequested = false;
	stop.addEventListener('click', () => {
		stopRequested = true;
		stop.disabled = true;
		stop.textContent = 'Stopping…';
	});

	// The panel lives inside a notification that closes on a timer, and it is the
	// only place the Stop button and the progress line exist. At the default cap
	// of 100 comments at one request a second a run is already most of two
	// minutes, and `maxPerRun` is free text against a listing that reaches 1000 —
	// so a long run outlived its own panel at fifteen minutes while the loop kept
	// deleting. Each progress tick restarts the close timer through the
	// `notification-reset` event `notifications.js` already listens for.
	function keepPanelOpen() {
		const host = wrapper.closest('.RESNotification');
		if (host) host.dispatchEvent(new CustomEvent('notification-reset'));
	}

	// Renewed while the run is going, so a tab that dies mid-run stops renewing
	// and the account frees itself within the lease's TTL.
	let heartbeat = null;

	function endRun() {
		runInFlight = false;
		if (heartbeat !== null) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		stop.hidden = true;
		// Released rather than left to expire: the next run should not have to wait
		// out a TTL for a lease whose owner has finished.
		lease.release().catch(() => { /* the TTL is the backstop */ });
	}

	async function start() {
		if (runInFlight) {
			status.hidden = false;
			status.textContent = 'A shred run is already going in this tab. Wait for it to finish before starting a second one.';
			return;
		}

		// Disabled while the lease is being asked for, so a double click cannot
		// produce two runs in the gap before the answer arrives.
		go.disabled = true;
		status.hidden = false;
		status.textContent = 'Checking whether another run is going…';

		let grant;
		try {
			grant = await lease.acquire();
		} catch (e) {
			// The background is the only thing that knows whether another tab is
			// already deleting for this account. If it cannot be reached, refusing is
			// the only safe answer — starting anyway is the exact overlap the lease
			// exists to prevent.
			console.error('RES-Slim: could not reach the shred lease', e);
			grant = { ok: false, reason: 'unreachable', owner: null };
		}

		if (!grant || !grant.ok) {
			// A refusal is retryable: the other run finishes, and this panel is still
			// the one holding the plan the user already confirmed.
			status.textContent = refusalMessage(grant);
			go.disabled = input.value.trim() !== 'DELETE';
			return;
		}

		runInFlight = true;
		go.textContent = 'Shredding…';
		label.hidden = true;
		stop.hidden = false;
		status.textContent = `0 of ${count}…`;
		heartbeat = setInterval(() => {
			lease.renew(stopRequested ? 'stopping' : 'running').catch(() => { /* the TTL is the backstop */ });
		}, SHRED_LEASE_HEARTBEAT_MS);

		onConfirm({
			// Called before each item, so the count is what has been *attempted*,
			// not what succeeded — the summary at the end reports the split.
			onProgress(done: number) {
				keepPanelOpen();
				status.textContent = stopRequested ?
					`Finishing the current comment… ${done} of ${count}` :
					`${done} of ${count}…`;
			},
			// Checked once per iteration. A stop lands between comments, never
			// between a comment's overwrite and its delete — stopping there would
			// manufacture exactly the stranded state the two-try split exists to
			// report.
			shouldStop: () => stopRequested,
			finish(message: string) {
				endRun();
				go.textContent = 'Done';
				status.textContent = message;
			},
			// A throw out of `execute` stranded the panel on "Shredding…" with no
			// way to tell a hung run from a finished one — and the call site had no
			// `.catch` at all, so the error went to an unhandled rejection nobody
			// would ever see.
			fail(reason: string) {
				endRun();
				go.textContent = 'Failed';
				status.textContent = `The run stopped on an unexpected error, and may have finished part of the work. Check your comments before running it again. (${reason})`;
			},
		});
	}

	// Not `{ once: true }` any more: a refusal has to leave the button usable, and
	// `runInFlight` plus the disabled button already stop a second start.
	go.addEventListener('click', () => {
		start().catch(e => {
			// `start` handles its own failures; anything reaching here is a bug in
			// the panel rather than in the run, and must not become an unhandled
			// rejection nobody sees.
			console.error('RES-Slim: shred could not start', e);
			status.hidden = false;
			status.textContent = 'Could not start the run. Reload the page and try again.';
			go.disabled = input.value.trim() !== 'DELETE';
		});
	});

	wrapper.append(go, stop, status);

	return wrapper;
}

// Exported for `comment-shredder-contract`: the stop/progress contract is about
// what does and does not get sent, which cannot be read off the source.
export async function execute(selected: *, uh: string, limiter: *, controls: *) {
	const template = String(module.options.overwriteText.value || '').trim() || DEFAULT_OVERWRITE_TEXT;
	const alsoDelete = module.options.deleteAfterOverwrite.value === true;

	let overwritten = 0;
	let deleted = 0;
	let stranded = 0;
	let untouched = 0;
	let stopped = false;

	// Sequential rather than Promise.all: the overwrite must land before the
	// delete for the same comment, and reddit's write limiter is per-account, so
	// parallelism buys nothing but 429s.
	let index = 0;
	for (const decision of selected) {
		// Checked at the top of the iteration, so a stop never lands between a
		// comment's overwrite and its delete.
		if (controls.shouldStop()) { stopped = true; break; }

		const { fullname } = decision.item;
		index++;
		controls.onProgress(index);

		// The two calls get separate try blocks on purpose. Sharing one made a
		// failed delete after a successful overwrite indistinguishable from an
		// untouched comment, and the summary then told the user it had been "left
		// alone" — while its original text was already permanently gone.
		try {
			// eslint-disable-next-line no-await-in-loop
			await limiter.schedule(() => ajax({
				method: 'POST',
				url: '/api/editusertext',
				headers: { 'X-Modhash': uh },
				data: { thing_id: fullname, text: overwriteBody(template, index), api_type: 'json', uh },
			}));
		} catch (e) {
			untouched++;
			continue;
		}

		overwritten++;
		if (!alsoDelete) continue;

		try {
			// eslint-disable-next-line no-await-in-loop
			await limiter.schedule(() => ajax({
				method: 'POST',
				url: '/api/del',
				headers: { 'X-Modhash': uh },
				data: { id: fullname, uh },
			}));
			deleted++;
		} catch (e) {
			stranded++;
		}
	}

	const message = summariseOutcome({
		overwritten,
		deleted,
		stranded,
		untouched,
		stopped,
		remaining: stopped ? selected.length - index : 0,
	});

	// Written into the panel the user is already looking at as well as a toast:
	// the plan notification can be dismissed mid-run, and a run that reports only
	// into a surface that no longer exists reports nothing.
	controls.finish(message);

	showNotification({
		moduleID: 'commentShredder',
		notificationID: 'commentShredder-done',
		header: 'Shred my comments',
		message,
		closeDelay: 20000,
	});
}

async function run(link: HTMLAnchorElement) {
	if (link.getAttribute('aria-busy') === 'true') return;

	const me = loggedInUser();
	const profile = currentUserProfile();
	if (!me || !profile || me.toLowerCase() !== profile.toLowerCase()) return;

	link.setAttribute('aria-busy', 'true');
	const label = link.textContent;
	link.textContent = 'reading your comments…';

	const perSecond = parseInt(module.options.requestsPerSecond.value, 10) || 1;
	const limiter = createRateLimiter({ tokens: perSecond, refillMs: Math.round(1000 / perSecond), maxConcurrent: 1 });

	let items;
	try {
		items = await fetchAllComments(me, limiter);
	} catch (e) {
		link.textContent = label;
		link.removeAttribute('aria-busy');
		showNotification({
			moduleID: 'commentShredder',
			notificationID: 'commentShredder-fetch-failed',
			header: 'Shred my comments',
			message: 'Could not read your comment history. Reload and try again.',
		});
		return;
	}

	const plan = planShred(items, shredOptions(), Date.now());
	link.textContent = label;
	link.removeAttribute('aria-busy');

	const body = summarise(plan, items.length);

	if (module.options.dryRun.value === true) {
		const note = document.createElement('p');
		note.style.margin = '8px 0 0';
		note.textContent = 'Preview only, so nothing was changed. Turn off "Preview only" in settings to arm this.';
		body.append(note);
	} else if (!plan.selected.length) {
		const note = document.createElement('p');
		note.style.margin = '8px 0 0';
		note.textContent = 'Nothing matched, so there is nothing to do.';
		body.append(note);
	} else {
		const uh = await loggedInUserHash();
		if (!uh) {
			const note = document.createElement('p');
			note.style.margin = '8px 0 0';
			note.textContent = 'Could not read your login token, so nothing was changed. Reload the page and try again.';
			body.append(note);
		} else {
			body.append(confirmPanel(plan.selected.length, controls => {
				execute(plan.selected, uh, limiter, controls).catch(e => {
					console.error('RES-Slim: shred run failed', e);
					controls.fail(String((e && e.message) || e));
				});
			}, accountLease(me)));
		}
	}

	showNotification({
		moduleID: 'commentShredder',
		notificationID: 'commentShredder-plan',
		header: 'Shred my comments',
		message: body,
		// A run of the default 100 comments at 1/s outlives two minutes, and the
		// panel is where progress and Stop live, so it must not close underneath one.
		closeDelay: 900000,
	});
}

function injectLink() {
	const me = loggedInUser();
	const profile = currentUserProfile();
	// Only on your own profile. There is nothing here that could act on another
	// account, but building the control there at all would be misleading.
	if (!me || !profile || me.toLowerCase() !== profile.toLowerCase()) return;
	if (!/\/comments\/?$/.test(location.pathname)) return;

	const menu = document.querySelector('.tabmenu');
	if (!(menu instanceof HTMLElement)) return;
	if (menu.querySelector(`.${LINK_CLASS}`)) return;

	const item = document.createElement('li');
	item.className = LINK_CLASS;
	const link = string.html`<a href="#" role="button">shred…</a>`;
	link.setAttribute('aria-label', 'Preview which of your comments would be overwritten and deleted');
	link.title = 'Preview which of your comments match your shred filters';
	link.addEventListener('click', (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		run((link: any));
	});
	item.append(link);
	menu.append(item);
}

module.contentStart = () => {
	if (!isPageType('profile')) return;
	injectLink();
};
