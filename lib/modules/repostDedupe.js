/* @flow */
// RES-Slim: collapse repeated media in a listing. Crossposts and karma-farm
// reposts of an identical image URL show up over and over; this keys each post by
// its (normalised) link or thumbnail and dims/hides/badges the second-and-later
// appearance. Fully local, no network, O(n) over the listing. Disabled by default.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { createSeenTracker, normalizePostKey, thumbnailKey } from '../utils/repostDedupe';

export const module: Module<{ [string]: any }> = new Module('repostDedupe');

module.moduleName = 'Repost dedupe';
module.category = 'submissionsCategory';
module.description = 'Collapse repeat appearances of the same media in a feed. Keys each post by its normalized link/thumbnail; the first appearance is untouched, later duplicates are dimmed, hidden, or badged. Local-only, no network.';
module.descriptionRaw = true;
module.include = ['linklist', 'profile'];
module.disabledByDefault = true;
module.keywords = ['repost', 'duplicate', 'dedupe', 'crosspost', 'karma'];

module.options = {
	action: {
		type: 'enum',
		value: 'dim',
		values: [
			{ name: 'Dim (reduce opacity)', value: 'dim' },
			{ name: 'Badge only', value: 'badge' },
			{ name: 'Hide completely', value: 'hide' },
		],
		title: 'Action on duplicates',
		description: 'What to do with the second and later appearance of the same media.',
	},
};

const ATTR = 'data-rsm-repost';

function keyForThing(el: HTMLElement): ?string {
	const fromUrl = normalizePostKey(el.getAttribute('data-url'));
	if (fromUrl) return fromUrl;
	const thumb = el.querySelector('a.thumbnail img');
	return thumb instanceof HTMLImageElement ? thumbnailKey(thumb.getAttribute('src')) : null;
}

module.go = () => {
	const tracker = createSeenTracker();
	const action = module.options.action.value;

	watchForThings(['post'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement) || el.hasAttribute(ATTR)) return;

		const key = keyForThing(el);
		if (!key) return;
		el.setAttribute(ATTR, '1');

		if (!tracker.seen(key)) return; // first appearance — leave it

		if (action === 'hide') {
			el.style.display = 'none';
			return;
		}
		if (action === 'dim') el.style.opacity = '0.4';

		const titleEl = el.querySelector('a.title');
		if (titleEl instanceof HTMLElement) {
			const badge = document.createElement('span');
			badge.className = 'rsm-repost-badge';
			badge.textContent = 'repost';
			badge.title = 'Same media already appeared higher in this listing';
			titleEl.after(badge);
		}
	});
};
