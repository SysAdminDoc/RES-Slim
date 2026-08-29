/* @flow */
// RES-Slim: show absolute timestamps alongside the relative "3 hours ago" text.
// Reddit already emits the absolute time in the title= attribute of every .live-timestamp,
// so no additional parsing is needed.
// Inspired by uptonking's "reddit tweaks" userscript and upstream RES's showTimeStamps option.

import { Module } from '../core/module';
import { watchForElements } from '../utils';

export const module: Module<{ [string]: any }> = new Module('absoluteTimestamps');

module.moduleName = 'Absolute timestamps';
module.category = 'commentsCategory';
module.description = 'Shows "2026-04-09 14:32" next to "3 hours ago" on posts and comments, using the timestamp Reddit already embeds.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.options = {
	format: {
		type: 'enum',
		value: 'locale',
		values: [
			{ name: 'Locale default', value: 'locale' },
			{ name: 'ISO (YYYY-MM-DD HH:MM)', value: 'iso' },
		],
		title: 'Format',
		description: 'Which format to display.',
	},
	replaceRelative: {
		type: 'boolean',
		value: false,
		title: 'Replace relative text',
		description: 'Replace "3 hours ago" with the absolute timestamp instead of showing both.',
	},
};

function formatDate(d: Date): string {
	if (module.options.format.value === 'iso') {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}
	return d.toLocaleString();
}

function decorate(time: HTMLElement) {
	if (time.dataset.resSlimTs) return;
	time.dataset.resSlimTs = '1';
	const title = time.getAttribute('title') || time.getAttribute('datetime');
	if (!title) return;
	const d = new Date(title);
	if (Number.isNaN(d.getTime())) return;
	const formatted = formatDate(d);
	if (module.options.replaceRelative.value) {
		time.textContent = formatted;
	} else {
		const span = document.createElement('span');
		span.className = 'res-slim-abs-ts';
		// De-emphasised with the managed muted ink rather than `opacity: 0.75`.
		// Fading the inherited colour is what broke it: on the light Classic
		// palette reddit's own tagline grey came out at 3.16:1 against #f5f5f5 once
		// a quarter of it was taken away, and axe measured exactly that. The token
		// is contrast-checked against both grounds and flips with the palette,
		// which an opacity multiplier cannot do.
		span.style.color = 'var(--rsm-ink-muted)';
		span.style.marginLeft = '4px';
		span.textContent = `(${formatted})`;
		time.insertAdjacentElement('afterend', span);
	}
}

module.contentStart = () => {
	document.querySelectorAll('time').forEach(t => {
		if (t instanceof HTMLElement) decorate(t);
	});
	watchForElements(['page'], 'time', (ele: HTMLElement) => decorate(ele));
};
