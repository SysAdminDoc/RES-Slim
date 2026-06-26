/* @flow */
// RES-Slim: optional thread auto-refresh with exponential backoff. Adds a
// small toolbar control to the .commentarea; when toggled on, the module
// periodically refetches the current thread JSON sorted by new and splices
// any unseen comments into the existing tree, highlighted.

import { Module } from '../core/module';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { createRateLimiter } from '../utils/rateLimiter';
import { escapeHTML } from '../utils/html';
import DOMPurify from 'dompurify';

export const module: Module<*> = new Module('autoRefreshComments');

module.moduleName = 'Auto-refresh comments';
module.category = 'commentsCategory';
module.description = 'Periodically refetch this thread for new comments. Exponential backoff when nothing changes.';
module.descriptionRaw = true;
module.include = ['comments'];
module.keywords = ['comments', 'refresh', 'live', 'auto', 'poll', 'backoff'];

module.options = {
	startIntervalSeconds: {
		type: 'text',
		value: '30',
		title: 'Starting interval (seconds)',
		description: 'Time between the first few refresh attempts. Doubles after each empty poll up to the cap.',
	},
	maxIntervalSeconds: {
		type: 'text',
		value: '300',
		title: 'Maximum interval (seconds)',
		description: 'Upper cap for the backoff (default 5 minutes).',
	},
};

const TOGGLE_ID = 'RSMAutoRefreshComments';
const limiter = createRateLimiter({ tokens: 4, refillMs: 1000, maxConcurrent: 2 });

let timer: TimeoutID | null = null;
let currentInterval = 0;
let running = false;

function startInterval(): number {
	const raw = Number(module.options.startIntervalSeconds.value);
	return Number.isFinite(raw) && raw >= 5 ? raw * 1000 : 30000;
}
function maxInterval(): number {
	const raw = Number(module.options.maxIntervalSeconds.value);
	return Number.isFinite(raw) && raw >= startInterval() / 1000 ? raw * 1000 : 300000;
}

function safeCommentBodyHtml(comment: { body?: string, body_html?: string }): string {
	const html = typeof comment.body_html === 'string' && comment.body_html ?
		comment.body_html :
		`<div class="md"><p>${escapeHTML(comment.body || '')}</p></div>`;
	return DOMPurify.sanitize(html);
}

async function pollOnce(): Promise<number> {
	if (!location.pathname.includes('/comments/')) return 0;
	const url = `${location.pathname.replace(/\/$/, '')}.json?raw_json=1&sort=new&depth=10&limit=200`;
	const json = await limiter.schedule(async () => {
		const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (!response.ok) throw new Error(`status ${response.status}`);
		return response.json();
	});
	if (!Array.isArray(json) || json.length < 2) return 0;
	const children = json[1] && json[1].data && json[1].data.children;
	if (!Array.isArray(children)) return 0;

	const known = new Set(Array.from(document.querySelectorAll('.commentarea .thing.comment[data-fullname]'), el => el.getAttribute('data-fullname')));
	const newOnes = children.filter(c => c && c.data && c.kind === 't1' && !known.has(c.data.name));
	if (!newOnes.length) return 0;

	const sitetable = document.querySelector('.commentarea .sitetable.nestedlisting');
	if (!(sitetable instanceof HTMLElement)) return 0;

	for (const child of newOnes) {
		const d = child.data;
		const placeholder = document.createElement('div');
		placeholder.className = 'thing comment rsm-auto-refresh-new';
		placeholder.dataset.fullname = d.name;
		setTrustedHTML(placeholder, `<div class="entry">
			<p class="tagline">by <a class="author">${escapeHTML(d.author || '[deleted]')}</a>
			· <span class="score unvoted">${typeof d.score === 'number' ? d.score : '?'} pt</span></p>
			<div class="usertext-body">${safeCommentBodyHtml(d)}</div>
		</div>`);
		sitetable.prepend(placeholder);
	}
	return newOnes.length;
}

function schedule() {
	if (!running) return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(async () => {
		try {
			const added = await pollOnce();
			if (added > 0) {
				currentInterval = startInterval();
			} else {
				currentInterval = Math.min(maxInterval(), Math.max(startInterval(), currentInterval * 2 || startInterval()));
			}
		} catch (e) {
			// Network blip — slow down but stay on.
			currentInterval = Math.min(maxInterval(), Math.max(startInterval(), currentInterval * 2 || startInterval()));
		}
		schedule();
	}, currentInterval || startInterval());
}

function syncToggleButton(button: HTMLButtonElement) {
	button.classList.toggle('is-on', running);
	button.setAttribute('aria-pressed', running ? 'true' : 'false');
	button.textContent = running ? 'auto-refresh: on' : 'auto-refresh: off';
}

function injectToggle() {
	const commentarea = document.querySelector('.commentarea');
	if (!(commentarea instanceof HTMLElement)) return;
	if (document.getElementById(TOGGLE_ID)) return;
	const host = commentarea.querySelector('.menuarea') || commentarea;
	const button = document.createElement('button');
	button.id = TOGGLE_ID;
	button.type = 'button';
	button.className = 'rsm-auto-refresh-toggle';
	button.addEventListener('click', () => {
		running = !running;
		syncToggleButton(button);
		if (running) {
			currentInterval = startInterval();
			schedule();
		} else if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}, false);
	syncToggleButton(button);
	host.prepend(button);
}

module.contentStart = () => {
	injectToggle();
};
