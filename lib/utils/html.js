/* @flow */

const escapeLookups = {
	'&': '&amp;',
	'"': '&quot;',
	"'": '&apos;', // eslint-disable-line quotes
	'<': '&lt;',
	'>': '&gt;',
	'/': '&#47;',
};

export function escapeHTML(str: ?string): string {
	return str ?
		str.toString().replace(/[&"'<>\/]/g, m => escapeLookups[m]) :
		'';
}

// Decode HTML entities in third-party text *without* parsing it as markup.
//
// A `<textarea>`'s content model is RCDATA — plain text with character
// references — so assigning to its `innerHTML` resolves entities but never
// instantiates an element. Assign the same string to a `<div>` and
// `&lt;img src=x onerror=…&gt;` becomes a live `<img>` whose handler the
// browser will run; that was a real DOM-XSS in commentPreview's wiki table of
// contents, reachable from any heading in any wiki page it rendered.
//
// Lives here, and is exported, so the property can be tested by executing it.
// Inline in the middle of the TOC builder it was only ever assertable by
// pattern-matching the source, which proves the code is *written*, not that it
// runs or that it works.
export function decodeEntitiesAsText(str: ?string): string {
	if (!str) return '';
	const decoder = document.createElement('textarea');
	decoder.innerHTML = str.toString();
	return decoder.value;
}
