/* @flow */

import { findElement } from './findElement';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = [50, 100, 200, 400, 800];

function normalizeSelectors(selectors: string | Array<string>): Array<string> {
	return Array.isArray(selectors) ? selectors.filter(Boolean) : [selectors].filter(Boolean);
}

function findInAddedNode(node: Node, selectors: Array<string>): ?Element {
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	const element = (node: any);
	for (const selector of selectors) {
		if (element.matches(selector)) return element;
		const descendant = element.querySelector(selector);
		if (descendant) return descendant;
	}
}

export function waitForElement(
	root: Document | Element,
	selectors: string | Array<string>,
	{ timeoutMs = DEFAULT_TIMEOUT_MS, backoffMs = DEFAULT_BACKOFF_MS }: {| timeoutMs?: number, backoffMs?: Array<number> |} = {},
): Promise<Element> {
	const selectorList = normalizeSelectors(selectors);
	const immediate = findElement(root, selectorList);
	if (immediate) return Promise.resolve(immediate);

	return new Promise((resolve, reject) => {
		let done = false;
		let backoffIndex = 0;
		let retryTimer;

		const cleanup = () => {
			done = true;
			observer.disconnect();
			clearTimeout(timeoutTimer);
			clearTimeout(retryTimer);
		};

		const resolveWith = element => {
			if (done) return;
			cleanup();
			resolve(element);
		};

		const checkRoot = () => {
			if (done) return;
			const element = findElement(root, selectorList);
			if (element) {
				resolveWith(element);
				return;
			}
			const wait = backoffMs[Math.min(backoffIndex, backoffMs.length - 1)];
			backoffIndex += 1;
			retryTimer = setTimeout(checkRoot, wait);
		};

		const observer = new MutationObserver(mutations => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					const element = findInAddedNode(node, selectorList);
					if (element) {
						resolveWith(element);
						return;
					}
				}
			}
		});

		const timeoutTimer = setTimeout(() => {
			if (done) return;
			cleanup();
			reject(new Error(`Timed out waiting for selector: ${selectorList.join(', ')}`));
		}, timeoutMs);

		observer.observe(root, { childList: true, subtree: true });
		checkRoot();
	});
}
