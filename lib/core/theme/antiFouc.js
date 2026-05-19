/* @flow */

export const ANTI_FOUC_STYLE_ID = 'rsm-anti-fouc-style';
export const ANTI_FOUC_CLASSES = Object.freeze([
	'rsm-root',
	'rsm-theme-dark',
	'rsm-theme-oled',
	'res-nightmode',
]);

const EARLY_DARK_CSS = `
:root.rsm-theme-oled {
	color-scheme: dark;
	background: #050608;
}

:root.rsm-theme-oled body {
	background: #050608;
}
`;

function ensureAntiFoucStyle(documentRef) {
	const existing = documentRef.getElementById(ANTI_FOUC_STYLE_ID);
	if (existing) return existing;

	const style = documentRef.createElement('style');
	style.id = ANTI_FOUC_STYLE_ID;
	style.dataset.rsmCore = 'anti-fouc';
	style.textContent = EARLY_DARK_CSS;
	(documentRef.head || documentRef.documentElement).appendChild(style);
	return style;
}

export function applyAntiFoucTheme({ documentRef = document } = {}) {
	const root = documentRef.documentElement;
	if (!root) return () => undefined;

	root.classList.add(...ANTI_FOUC_CLASSES);
	if (documentRef.body) documentRef.body.classList.add(...ANTI_FOUC_CLASSES);

	const style = ensureAntiFoucStyle(documentRef);

	return () => {
		root.classList.remove(...ANTI_FOUC_CLASSES);
		if (documentRef.body) documentRef.body.classList.remove(...ANTI_FOUC_CLASSES);
		if (style.parentNode) style.remove();
	};
}
