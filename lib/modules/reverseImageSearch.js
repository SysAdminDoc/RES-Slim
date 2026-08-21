/* @flow */
// RES-Slim: reverse-image-search a post without leaving the listing.
//
// Concept from "Reddit Image Search Add-on" (Greasy Fork 41880). Every engine
// takes the image URL as a query parameter, so the lookup happens in the tab you
// open — RES-Slim never uploads the image or contacts the engine. URL building
// is in lib/utils/reverseImageSearch.js.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { ENGINES, bestImageUrlFor, reverseSearchUrls } from '../utils/reverseImageSearch';

export const module: Module<{ [string]: any }> = new Module('reverseImageSearch');

module.moduleName = 'Reverse image search';
module.category = 'browsingCategory';
module.description = 'Adds a small "source" menu to image posts that opens the image in Google Lens, Yandex, TinEye, Bing or SauceNAO. The image is passed by URL, so nothing is uploaded and no engine is contacted until you click.';
module.descriptionRaw = true;
module.include = ['linklist', 'search', 'profile', 'comments', 'commentsLinklist'];
module.disabledByDefault = true;
module.keywords = ['reverse', 'image', 'search', 'source', 'lens', 'tineye', 'yandex', 'saucenao'];

module.options = {
	engines: {
		type: 'enum',
		value: 'lens,yandex,tineye',
		values: [
			{ name: 'Google Lens, Yandex, TinEye', value: 'lens,yandex,tineye' },
			{ name: 'Google Lens only', value: 'lens' },
			{ name: 'Yandex only (best for faces and places)', value: 'yandex' },
			{ name: 'Everything, including SauceNAO and Bing', value: 'lens,yandex,tineye,bing,saucenao' },
		],
		title: 'Engines',
		description: 'Which engines to offer. Each is a plain link.',
	},
	placement: {
		type: 'enum',
		value: 'buttons',
		values: [
			{ name: 'A row of small links', value: 'buttons' },
			{ name: 'One "source" link that expands', value: 'compact' },
		],
		title: 'Placement',
		description: 'Compact keeps long listings tidy.',
	},
};

const ATTR = 'data-rsm-reverse-search';
const CLASS = 'rsm-reverseImageSearch';

function enabledEngines(): string[] {
	const raw = String(module.options.engines.value || '');
	const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
	const known = new Set(ENGINES.map(e => e.id));
	return ids.filter(id => known.has(id));
}

function buildLinks(imageUrl: string): ?HTMLElement {
	const targets = reverseSearchUrls(imageUrl, enabledEngines());
	if (!targets.length) return null;

	const wrapper = document.createElement('span');
	wrapper.className = CLASS;
	wrapper.style.marginLeft = '6px';
	wrapper.style.fontSize = '11px';

	const compact = module.options.placement.value === 'compact';
	const list = document.createElement('span');
	list.className = `${CLASS}-list`;
	if (compact) list.hidden = true;

	for (const target of targets) {
		const anchor = document.createElement('a');
		anchor.href = target.url;
		anchor.textContent = target.name;
		anchor.target = '_blank';
		anchor.rel = 'noopener noreferrer';
		anchor.style.marginRight = '6px';
		anchor.setAttribute('aria-label', `Reverse image search on ${target.name}`);
		list.append(anchor);
	}

	if (compact) {
		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = `${CLASS}-toggle`;
		toggle.textContent = 'source';
		toggle.setAttribute('aria-expanded', 'false');
		toggle.style.background = 'none';
		toggle.style.border = '0';
		toggle.style.padding = '0';
		toggle.style.cursor = 'pointer';
		toggle.style.color = 'inherit';
		toggle.style.font = 'inherit';
		toggle.style.textDecoration = 'underline';
		toggle.addEventListener('click', () => {
			const open = list.hidden;
			list.hidden = !open;
			toggle.setAttribute('aria-expanded', String(open));
		});
		wrapper.append(toggle, ' ', list);
	} else {
		wrapper.append(list);
	}

	return wrapper;
}

function processThing(thing: Thing) {
	const el = thing.element;
	if (!(el instanceof HTMLElement) || el.hasAttribute(ATTR)) return;
	if (!thing.isPost()) return;

	const imageUrl = bestImageUrlFor(thing.getPostUrl(), thing.getPostThumbnailUrl());
	if (!imageUrl) return;

	const buttons = thing.getButtons();
	if (!(buttons instanceof HTMLElement)) return;

	const links = buildLinks(imageUrl);
	if (!links) return;

	el.setAttribute(ATTR, '1');

	const item = document.createElement('li');
	item.append(links);
	buttons.append(item);
}

module.contentStart = () => {
	watchForThings(['post'], processThing);
};
