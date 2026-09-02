/* @flow */
// RES-Slim: skip Reddit's viewer chrome on direct-media posts. Posts whose
// `data-domain` is in the configured direct-host list AND whose `data-url`
// points at a direct image/video URL have their title link rewritten to
// open the raw media, optionally in a new tab.
//
// Does not touch comments-page navigation — the rewrite is on listing rows
// only, so reddit's "open comments" affordance remains the dedicated
// comments link (`a.bylink.comments`).

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import {
	normalizeImgurGifv,
	parseDomainList,
	shouldRewrite,
} from '../utils/directImage';

export const module: Module<{ [string]: any }> = new Module('directImage');

module.moduleName = 'Display-direct image';
module.category = 'productivityCategory';
module.description = 'On posts hosted directly on i.redd.it / i.imgur.com / etc., the post title links to the raw image/video instead of the Reddit viewer wrapper. Comments link (`a.bylink.comments`) is untouched.';
module.descriptionRaw = true;
module.include = ['linklist', 'comments'];
module.disabledByDefault = true;
module.keywords = ['image', 'direct', 'open', 'imgur', 'i.redd.it', 'viewer'];

module.options = {
	hosts: {
		type: 'text',
		value: 'i.redd.it, i.imgur.com, v.redd.it, preview.redd.it',
		title: 'Direct-media domains',
		description: 'Comma- or newline-separated list of domains to treat as direct-media. Defaults cover Reddit-hosted media and Imgur direct uploads.',
	},
	includeVideo: {
		type: 'boolean',
		value: true,
		title: 'Include video files',
		description: 'Also rewrite links to .mp4 / .webm / imgur .gifv files.',
	},
	openInNewTab: {
		type: 'boolean',
		value: true,
		title: 'Open in new tab',
		description: 'Add target="_blank" so the raw media opens in a new tab.',
	},
	mark: {
		type: 'boolean',
		value: true,
		title: 'Mark rewritten links',
		description: 'Mark links this option has rewritten so you can tell them apart.',
	},
};

const ATTR = 'data-rsm-direct-image';

function process(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	if (el.getAttribute('data-type') !== 'link') return;

	const hosts = parseDomainList(module.options.hosts.value);
	const includeVideo = module.options.includeVideo.value !== false;
	const domain = el.getAttribute('data-domain') || '';
	const url = el.getAttribute('data-url') || '';
	if (!shouldRewrite(domain, url, hosts, includeVideo)) return;

	const title = el.querySelector(':scope > .entry p.title > a.title');
	if (!(title instanceof HTMLAnchorElement)) return;
	if (title.getAttribute(ATTR) === '1') return;

	const finalUrl = normalizeImgurGifv(url);
	title.href = finalUrl;
	if (module.options.openInNewTab.value !== false) {
		title.target = '_blank';
		title.rel = 'noopener noreferrer';
	}
	if (module.options.mark.value !== false) {
		title.setAttribute(ATTR, '1');
		title.title = `Direct media: ${finalUrl}`;
	}
}

module.contentStart = () => {
	watchForThings(['post'], process);
};
