/* @flow */

import { getSurfaceSelectorList } from './selectors';

function normalizeSelectors(selectors: string | Array<string>): Array<string> {
	return Array.isArray(selectors) ? selectors.filter(Boolean) : [selectors].filter(Boolean);
}

export function findElement(root: Document | Element, selectors: string | Array<string>): ?Element {
	for (const selector of normalizeSelectors(selectors)) {
		const element = root.querySelector(selector);
		if (element) return element;
	}
}

export function findElements(root: Document | Element, selectors: string | Array<string>): Array<Element> {
	const found = [];
	const seen = new Set();
	for (const selector of normalizeSelectors(selectors)) {
		for (const element of root.querySelectorAll(selector)) {
			if (seen.has(element)) continue;
			seen.add(element);
			found.push(element);
		}
	}
	return found;
}

export function findSurface(root: Document | Element, surfaceName: string): ?Element {
	return findElement(root, getSurfaceSelectorList(surfaceName));
}

export function findSurfaces(root: Document | Element, surfaceName: string): Array<Element> {
	return findElements(root, getSurfaceSelectorList(surfaceName));
}
