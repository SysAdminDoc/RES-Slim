/* @flow */
// RES-Slim: resolve "Processing img xxxxx..." placeholders that old.reddit.com
// fails to render when comments embed images via the new-reddit media uploader.
// Inspired by littux's "Fix 'Processing img <id>' on old reddit" GreasyFork userscript.

import { Module } from '../core/module';
import { watchForElements } from '../utils';
import { ajax } from '../environment';

export const module: Module<*> = new Module('fixProcessingImg');

module.moduleName = 'Fix "Processing img" placeholders';
module.category = 'appearanceCategory';
module.description = 'Replaces "Processing img abc123..." placeholder text in old.reddit comments with the actual image, fetched from Reddit\'s API.';
module.descriptionRaw = true;
module.include = ['comments', 'commentsLinklist', 'profile', 'inbox'];
module.options = {
	enabled: {
		type: 'boolean',
		value: true,
		title: 'Enabled',
		description: 'Automatically resolve "Processing img" placeholders in comments.',
	},
};

const placeholderRe = /Processing img ([a-z0-9]+)\.{3}/;
const resolved = new Set<string>();

async function resolvePermalink(permalink: string): Promise<?Document> {
	try {
		const html = await ajax({ url: permalink, type: 'text' });
		const parser = new DOMParser();
		return parser.parseFromString(html, 'text/html');
	} catch {
		return null;
	}
}

async function fixCommentBody(body: HTMLElement) {
	const text = body.textContent || '';
	const match = placeholderRe.exec(text);
	if (!match) return;
	const [placeholder, id] = match;
	if (resolved.has(id)) return;
	resolved.add(id);

	// Try to find the permalink for this comment.
	const comment = body.closest('.comment');
	if (!comment) return;
	const permalinkAnchor: ?HTMLAnchorElement = (comment.querySelector('a.bylink[href*="/comments/"]'): any);
	if (!permalinkAnchor) return;

	const doc = await resolvePermalink(permalinkAnchor.href);
	if (!doc) return;

	// Find the image in the fetched JSON-rendered comment - Reddit embeds it
	// inline on the new-reddit rendering of the permalink page.
	const img = doc.querySelector(`img[src*="${id}"]`);
	if (!img) return;
	const src = img.getAttribute('src');
	if (!src) return;

	const replacement = document.createElement('a');
	replacement.href = src;
	replacement.target = '_blank';
	replacement.rel = 'noopener';
	const inlineImg = document.createElement('img');
	inlineImg.src = src;
	inlineImg.style.maxWidth = '100%';
	inlineImg.style.maxHeight = '480px';
	replacement.append(inlineImg);

	// Replace the text node containing the placeholder.
	const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		if (node.textContent && node.textContent.includes(placeholder)) {
			const parent = node.parentNode;
			if (parent) parent.replaceChild(replacement, node);
			break;
		}
		node = walker.nextNode();
	}
}

module.contentStart = () => {
	if (!module.options.enabled.value) return;
	watchForElements(['comments'], '.md', (ele: HTMLElement) => { fixCommentBody(ele); });
};
