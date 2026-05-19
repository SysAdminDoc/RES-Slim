/* @flow */

const POLICY_NAME = 'res-slim-html';

let trustedHtmlPolicy;

export function getTrustedHtmlPolicy(): ?{ createHTML(string): string } {
	if (trustedHtmlPolicy) return trustedHtmlPolicy;
	if (typeof window === 'undefined' || !window.trustedTypes) return;

	trustedHtmlPolicy = window.trustedTypes.createPolicy(POLICY_NAME, {
		createHTML: html => String(html),
	});
	return trustedHtmlPolicy;
}

export function createTrustedHTML(html: string): string {
	const policy = getTrustedHtmlPolicy();
	return policy ? policy.createHTML(html) : html;
}

export function setTrustedHTML(element: HTMLElement, html: string): void {
	element.innerHTML = createTrustedHTML(html);
}

export function insertTrustedHTML(element: HTMLElement, position: InsertPosition, html: string): void {
	element.insertAdjacentHTML(position, createTrustedHTML(html));
}
