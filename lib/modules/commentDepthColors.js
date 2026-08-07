/* @flow */
// RES-Slim: paint each .thing.comment's left collapse stripe with a colour
// that reflects its depth in the tree. Pure CSS rendering — applies a
// single stylesheet up front and a body class to opt in; depth is read
// off the existing nested .child wrappers via :nth-child and :where()
// combinators, so the module has no per-comment JS cost.

import { Module } from '../core/module';

export const module: Module<*> = new Module('commentDepthColors');

module.moduleName = 'Color-coded comment depth';
module.category = 'commentsCategory';
module.description = 'Tint each comment\'s collapse stripe by depth so deep replies are easy to scan.';
module.descriptionRaw = true;
module.include = ['comments'];
module.keywords = ['comment', 'depth', 'color', 'colour', 'collapse', 'stripe', 'thread'];

module.options = {
	saturation: {
		type: 'text',
		value: '70',
		title: 'Stripe saturation (0-100)',
		description: 'How vivid the depth stripes are. 70 is the recommended default.',
	},
	maxDepth: {
		type: 'text',
		value: '8',
		title: 'Max depth to colour',
		description: 'After this depth the colour cycles back through the palette.',
	},
};

const STYLE_ID = 'RSMCommentDepthColorsStyle';

function buildCss(): string {
	const saturation = Math.max(0, Math.min(100, Number(module.options.saturation.value) || 70));
	const maxDepth = Math.max(2, Math.min(20, Number(module.options.maxDepth.value) || 8));
	const rules = ['body.rsm-depth-colors .commentarea .thing.comment { border-left: 3px solid transparent; padding-left: 4px; }'];
	for (let i = 0; i < maxDepth; i++) {
		const hue = (i * 360) / maxDepth;
		const selectorChain = ':is(.commentarea)' + ` > .sitetable.nestedlisting${ ' .child'.repeat(i) } > .sitetable > .thing.comment`;
		rules.push(`body.rsm-depth-colors ${selectorChain} { border-left-color: hsl(${hue.toFixed(1)} ${saturation}% 58%); }`);
	}
	return rules.join('\n');
}

function inject() {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		(document.head || document.documentElement).append(style);
	}
	style.textContent = buildCss();
	if (document.body) document.body.classList.add('rsm-depth-colors');
}

module.beforeLoad = () => { inject(); };
module.contentStart = () => { inject(); };
