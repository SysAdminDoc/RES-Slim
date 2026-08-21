/* @flow */
// RES-Slim: lay out the listing feed in 2, 3, or 4 columns. Pure CSS via a
// body class and a CSS-grid layout for `#siteTable.linklisting`. Only fires
// on listing pages (front page, /r/<sub>/, multireddits, /r/all, etc.).

import { Module } from '../core/module';
import { isPageType } from '../utils';

export const module: Module<{ [string]: any }> = new Module('multiColumnFeed');

module.moduleName = 'Multi-column feed';
module.category = 'appearanceCategory';
module.description = 'Lay out listing pages in 2, 3, or 4 columns. Listing pages only — thread, profile, and search are unaffected. Mutex with layoutTweaks.fullWidth.';
module.descriptionRaw = true;
module.include = ['linklist', 'search'];
module.disabledByDefault = true;
module.keywords = ['column', 'multi', 'grid', 'layout', 'feed'];

module.options = {
	columnCount: {
		type: 'enum',
		value: '2',
		title: 'Columns',
		values: [
			{ name: '2 columns', value: '2' },
			{ name: '3 columns', value: '3' },
			{ name: '4 columns', value: '4' },
		],
		description: 'How many columns to lay the feed out in.',
	},
	includeSelfPosts: {
		type: 'boolean',
		value: true,
		title: 'Include self-text posts',
		description: 'Self-text posts can produce tall rows; uncheck to keep them in a single column at the top.',
	},
	useFullWidth: {
		type: 'boolean',
		value: true,
		title: 'Stretch to full viewport width',
		description: 'When on, the feed expands to fill the viewport so the columns get room to breathe. Disable if you already use layoutTweaks.fullWidth.',
	},
};

const STYLE_ID = 'RSMMultiColumnFeedStyle';
const BODY_CLASS = 'rsm-multiColumnFeed';

function columnCount(): number {
	const raw = String(module.options.columnCount.value || '2');
	const n = parseInt(raw, 10);
	if (n === 3 || n === 4) return n;
	return 2;
}

function buildCss(): string {
	const cols = columnCount();
	const fullWidth = module.options.useFullWidth.value !== false;
	const dropSelf = module.options.includeSelfPosts.value === false;
	const blocks: string[] = [];

	if (fullWidth) {
		blocks.push(`body.${BODY_CLASS} .content[role="main"] { max-width: none !important; margin-right: 12px !important; }`);
	}

	// Grid the listing. Use display: grid on the listing root and let .thing
	// rows be grid items. Anything that isn't a .thing (pager, nextprev, etc.)
	// spans the full row so it doesn't break the flow.
	blocks.push(`
		body.${BODY_CLASS} #siteTable.linklisting {
			display: grid;
			grid-template-columns: repeat(${cols}, minmax(0, 1fr));
			gap: 8px 12px;
			align-items: start;
		}

		body.${BODY_CLASS} #siteTable.linklisting > .thing {
			margin: 0 !important;
			max-width: none !important;
			min-width: 0;
		}

		body.${BODY_CLASS} #siteTable.linklisting > .clearleft,
		body.${BODY_CLASS} #siteTable.linklisting > .nav-buttons,
		body.${BODY_CLASS} #siteTable.linklisting > .menuarea,
		body.${BODY_CLASS} #siteTable.linklisting > .panestack-title {
			grid-column: 1 / -1;
		}

		body.${BODY_CLASS} #siteTable.linklisting > .thing > .entry .expando {
			max-width: 100%;
		}

		body.${BODY_CLASS} #siteTable.linklisting > .thing > .entry img[src] {
			max-width: 100%;
			height: auto;
		}
	`);

	if (dropSelf) {
		blocks.push(`body.${BODY_CLASS} #siteTable.linklisting > .thing.self { grid-column: 1 / -1; }`);
	}

	return blocks.join('\n');
}

function applyClasses(): void {
	if (!document.body) return;
	const on = isPageType('linklist');
	document.body.classList.toggle(BODY_CLASS, on);
}

function injectStyle(): void {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		(document.head || document.documentElement).append(style);
	}
	style.textContent = buildCss();
}

module.beforeLoad = () => { injectStyle(); };
module.contentStart = () => { injectStyle(); applyClasses(); };
