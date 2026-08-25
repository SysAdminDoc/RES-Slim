/* @flow */

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { DEFAULT_PATTERNS, matchTitle, mergePatterns, parsePatterns } from '../utils/engagementBait';
import { hideAndSilence } from '../utils/mediaSilence';

export const module: Module<{ [string]: any }> = new Module('engagementBaitFilter');

module.moduleName = 'Engagement-bait filter';
module.category = 'submissionsCategory';
module.description = 'Dim or badge posts whose titles match common ragebait/karma-farm patterns (AITA, ALL CAPS, numbered listicles, etc.). Pattern list is editable.';
module.descriptionRaw = true;
module.include = ['linklist', 'comments', 'profile'];
module.disabledByDefault = true;
module.keywords = ['bait', 'ragebait', 'karma', 'clickbait', 'AITA', 'listicle', 'engagement'];

module.options = {
	action: {
		type: 'enum',
		value: 'dim',
		values: [
			{ name: 'Dim (reduce opacity)', value: 'dim' },
			{ name: 'Badge only', value: 'badge' },
			{ name: 'Hide completely', value: 'hide' },
		],
		title: 'Action on matched posts',
		description: 'What to do when a post title matches a bait pattern.',
	},
	customPatterns: {
		type: 'text',
		value: '',
		title: 'Custom patterns (JSON)',
		description: 'JSON array of {pattern, label} objects. Custom patterns are checked before defaults. Pattern is a JavaScript regex.',
	},
};

const ATTR = 'data-rsm-bait';

module.go = () => {
	const custom = parsePatterns(module.options.customPatterns.value);
	const patterns = mergePatterns(DEFAULT_PATTERNS, custom);
	const action = module.options.action.value;

	watchForThings(['post'], (thing: Thing) => {
		const el = thing.element;
		if (el.hasAttribute(ATTR)) return;

		const titleEl = el.querySelector('a.title');
		if (!titleEl) return;
		const title = titleEl.textContent || '';

		const hit = matchTitle(title, patterns);
		if (!hit) return;

		el.setAttribute(ATTR, hit.label);

		if (action === 'hide') {
			hideAndSilence(el);
		} else if (action === 'dim') {
			el.style.opacity = '0.4';
		}

		if (action !== 'hide') {
			const badge = document.createElement('span');
			badge.className = 'rsm-bait-badge';
			badge.textContent = hit.label;
			badge.title = `Matched pattern: ${hit.pattern}`;
			titleEl.after(badge);
		}
	});
};
