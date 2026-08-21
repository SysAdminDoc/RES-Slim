/* @flow */

import selectorBundle from './selector-bundle.v1.json';

export const SELECTOR_BUNDLE_SCHEMA_VERSION: number = selectorBundle.schemaVersion;
export const SELECTOR_BUNDLE_VERSION: string = selectorBundle.bundleVersion;
export const SELECTOR_OVERRIDE_STORAGE_KEY = 'RESSelectorOverrides';

export type SurfaceDefinition = {|
	stable: string[],
	fallback: string[],
|};

export type SelectorOverrides = {|
	schemaVersion: number,
	bundleVersion: string,
	selectors: { [string]: { [string]: $Shape<SurfaceDefinition> } },
|};

export class InvalidSelectorOverrideError extends Error {}

const rendererBundles = selectorBundle.renderers;
export const surfaceSelectors = Object.freeze(rendererBundles.r2.surfaces);
export const d2xSurfaceSelectors = Object.freeze(rendererBundles.d2x.surfaces);
export const diagnosticSurfacesByPageType = Object.freeze(rendererBundles.r2.diagnostics);
export const d2xDiagnosticSurfacesByPageType = Object.freeze(rendererBundles.d2x.diagnostics);
export const RENDERER_NAMES = Object.freeze({
	r2: rendererBundles.r2.name,
	d2x: rendererBundles.d2x.name,
});

export const fixtureSurfaces = Object.freeze({
	frontpage: [
		'pageRoot', 'header', 'subredditBar', 'userbar', 'search', 'listingFeed',
		'post', 'postTitle', 'postMetadata', 'postActions', 'voteColumn', 'score',
		'expandoButton', 'expando', 'thumbnail', 'sidebar', 'author', 'settingsButton',
	],
	thread: [
		'pageRoot', 'header', 'userbar', 'search', 'commentArea', 'commentList',
		'comment', 'commentBody', 'commentChildren', 'collapseControl', 'composerForm',
		'submitButton', 'reportForm', 'saveHideControls', 'author', 'settingsButton',
	],
});

export const highChurnSurfaces = Object.freeze([
	'expandoButton', 'expando', 'commentChildren', 'collapseControl',
	'composerForm', 'reportForm', 'settingsOverlay',
]);

const baseSurfaceMaps = { r2: surfaceSelectors, d2x: d2xSurfaceSelectors };
const diagnosticMaps = { r2: diagnosticSurfacesByPageType, d2x: d2xDiagnosticSurfacesByPageType };

function emptyOverrides(): SelectorOverrides {
	return {
		schemaVersion: SELECTOR_BUNDLE_SCHEMA_VERSION,
		bundleVersion: SELECTOR_BUNDLE_VERSION,
		selectors: {},
	};
}

let activeOverrides: SelectorOverrides = emptyOverrides();

function isObject(value: mixed): boolean {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSelectorList(value: mixed, label: string, syntaxProbe?: (string) => mixed): string[] {
	if (!Array.isArray(value)) throw new InvalidSelectorOverrideError(`${label} must be an array.`);
	if (value.length > 16) throw new InvalidSelectorOverrideError(`${label} cannot contain more than 16 selectors.`);

	const selectors = value.map((entry, index) => {
		if (typeof entry !== 'string') throw new InvalidSelectorOverrideError(`${label}[${index}] must be a string.`);
		const selector = entry.trim();
		if (!selector) throw new InvalidSelectorOverrideError(`${label}[${index}] cannot be empty.`);
		if (selector.length > 1000) throw new InvalidSelectorOverrideError(`${label}[${index}] is too long.`);
		try {
			if (syntaxProbe) syntaxProbe(selector);
			else if (typeof document !== 'undefined') document.createDocumentFragment().querySelector(selector);
		} catch (error) {
			throw new InvalidSelectorOverrideError(`${label}[${index}] is not valid CSS: ${selector}`);
		}
		return selector;
	});
	if (new Set(selectors).size !== selectors.length) throw new InvalidSelectorOverrideError(`${label} contains a duplicate selector.`);
	return selectors;
}

export function normalizeSelectorOverrides(raw: mixed, syntaxProbe?: (string) => mixed): SelectorOverrides {
	if (!isObject(raw)) throw new InvalidSelectorOverrideError('The selector override must be a JSON object.');
	const input: any = raw;
	if (input.schemaVersion !== SELECTOR_BUNDLE_SCHEMA_VERSION) {
		throw new InvalidSelectorOverrideError(`schemaVersion must be ${SELECTOR_BUNDLE_SCHEMA_VERSION}.`);
	}
	if (!isObject(input.selectors)) throw new InvalidSelectorOverrideError('selectors must be an object.');

	const normalized = emptyOverrides();
	for (const appType of Object.keys(input.selectors)) {
		if (!baseSurfaceMaps[appType]) throw new InvalidSelectorOverrideError(`Unknown renderer: ${appType}.`);
		const rendererInput = input.selectors[appType];
		if (!isObject(rendererInput)) throw new InvalidSelectorOverrideError(`selectors.${appType} must be an object.`);
		const rendererOutput = {};

		for (const surfaceName of Object.keys(rendererInput)) {
			if (!baseSurfaceMaps[appType][surfaceName]) throw new InvalidSelectorOverrideError(`Unknown ${appType} surface: ${surfaceName}.`);
			const surfaceInput = rendererInput[surfaceName];
			if (!isObject(surfaceInput)) throw new InvalidSelectorOverrideError(`selectors.${appType}.${surfaceName} must be an object.`);
			const surfaceKeys = Object.keys(surfaceInput);
			const unknownKeys = surfaceKeys.filter(key => key !== 'stable' && key !== 'fallback');
			if (unknownKeys.length) throw new InvalidSelectorOverrideError(`Unknown key at selectors.${appType}.${surfaceName}: ${unknownKeys[0]}.`);
			if (!surfaceKeys.includes('stable') && !surfaceKeys.includes('fallback')) {
				throw new InvalidSelectorOverrideError(`selectors.${appType}.${surfaceName} must override stable or fallback.`);
			}

			const surfaceOutput = {};
			if (surfaceKeys.includes('stable')) {
				surfaceOutput.stable = validateSelectorList(surfaceInput.stable, `selectors.${appType}.${surfaceName}.stable`, syntaxProbe);
				if (!surfaceOutput.stable.length) throw new InvalidSelectorOverrideError(`selectors.${appType}.${surfaceName}.stable needs at least one selector.`);
			}
			if (surfaceKeys.includes('fallback')) {
				surfaceOutput.fallback = validateSelectorList(surfaceInput.fallback, `selectors.${appType}.${surfaceName}.fallback`, syntaxProbe);
			}
			rendererOutput[surfaceName] = surfaceOutput;
		}
		normalized.selectors[appType] = rendererOutput;
	}
	return normalized;
}

export function parseSelectorOverrides(serialized: string, syntaxProbe?: (string) => mixed): SelectorOverrides {
	let parsed;
	try {
		parsed = JSON.parse(serialized);
	} catch (error) {
		throw new InvalidSelectorOverrideError('The selector override is not valid JSON.');
	}
	return normalizeSelectorOverrides(parsed, syntaxProbe);
}

export function setSelectorOverrides(raw: mixed, syntaxProbe?: (string) => mixed): SelectorOverrides {
	activeOverrides = normalizeSelectorOverrides(raw, syntaxProbe);
	return getSelectorOverrides();
}

export function resetSelectorOverrides(): void {
	activeOverrides = emptyOverrides();
}

export function getSelectorOverrides(): SelectorOverrides {
	return JSON.parse(JSON.stringify(activeOverrides));
}

export function selectorOverrideCount(overrides: SelectorOverrides = activeOverrides): number {
	return Object.values(overrides.selectors).reduce(
		(total, renderer: any) => total + Object.keys(renderer).length,
		0,
	);
}

export function serializeSelectorOverrides(overrides: SelectorOverrides = activeOverrides): string {
	const normalized = normalizeSelectorOverrides(overrides);
	return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function surfaceMapFor(appType: string): { [string]: SurfaceDefinition } {
	const base = baseSurfaceMaps[appType] || surfaceSelectors;
	const rendererOverrides = activeOverrides.selectors[appType] || {};
	return Object.keys(base).reduce((resolved, surfaceName) => {
		const override = rendererOverrides[surfaceName] || {};
		resolved[surfaceName] = {
			stable: override.stable || base[surfaceName].stable,
			fallback: override.fallback || base[surfaceName].fallback,
		};
		return resolved;
	}, {});
}

export type SurfaceMatch = {|
	surfaceName: string,
	status: 'stable' | 'fallback' | 'missing',
	selector: ?string,
|};

export function getSurfaceSelectorList(surfaceName: string, appType: string = 'r2'): Array<string> {
	const surface = surfaceMapFor(appType)[surfaceName];
	if (!surface) throw new Error(`Unknown ${RENDERER_NAMES[appType] || appType} surface: ${surfaceName}`);
	return [...surface.stable, ...surface.fallback];
}

export function getStableSelector(surfaceName: string, appType: string = 'r2'): string {
	const surface = surfaceMapFor(appType)[surfaceName];
	if (!surface) throw new Error(`Unknown ${RENDERER_NAMES[appType] || appType} surface: ${surfaceName}`);
	return surface.stable[0];
}

export function findSurface(surfaceName: string, root: Document | HTMLElement = document, appType: string = 'r2'): ?HTMLElement {
	for (const selector of getSurfaceSelectorList(surfaceName, appType)) {
		const found = root.querySelector(selector);
		if (found && (found: any).nodeType === 1) return (found: any);
	}
	return null;
}

export function matchedSelectorFor(surfaceName: string, root: Document | HTMLElement = document, appType: string = 'r2'): ?string {
	for (const selector of getSurfaceSelectorList(surfaceName, appType)) {
		if (root.querySelector(selector)) return selector;
	}
	return null;
}

export function inspectSurfaceMatch(surfaceName: string, root: Document | HTMLElement = document, appType: string = 'r2'): SurfaceMatch {
	const selector = matchedSelectorFor(surfaceName, root, appType);
	let status: 'stable' | 'fallback' | 'missing' = 'missing';
	if (selector !== null) status = surfaceMapFor(appType)[surfaceName].stable.includes(selector) ? 'stable' : 'fallback';
	return { surfaceName, status, selector };
}

export function selectorDriftForPage(pageType: ?string, root: Document | HTMLElement = document, appType: string = 'r2'): SurfaceMatch[] {
	const required = pageType && (diagnosticMaps[appType] || diagnosticSurfacesByPageType)[pageType];
	if (!required) return [];
	return required
		.map(surfaceName => inspectSurfaceMatch(surfaceName, root, appType))
		.filter(match => match.status !== 'stable');
}

export function formatSelectorDriftMessage(pageType: string, findings: $ReadOnlyArray<SurfaceMatch>, appType: string = 'r2'): string {
	const details = findings.map(finding => finding.status === 'fallback' ?
		`${finding.surfaceName} matched fallback "${finding.selector || ''}"` :
		`${finding.surfaceName} is missing`);
	return `${RENDERER_NAMES[appType] || appType} selector drift detected on ${pageType}: ${details.join('; ')}.`;
}
