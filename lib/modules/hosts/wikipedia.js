/* @flow */

import { Host } from '../../core/host';
import * as Metadata from '../../core/metadata';
import { ajax } from '../../environment';

// Strip markup from a MediaWiki title without ever building a live element.
function titleText(markup: ?string): string {
	if (!markup) return '';
	return new DOMParser().parseFromString(String(markup), 'text/html').body.textContent || '';
}

const req = url => ajax({
	url,
	type: 'json',
	headers: {
		// See https://www.mediawiki.org/wiki/API:Main_page#Identifying_your_client
		'Api-User-Agent': `Reddit-Enhancement-Suite/${Metadata.version} ( ${Metadata.homepageURL} )`,
	},
});

export default new Host('wikipedia', {
	name: 'wikipedia',
	domains: ['wikipedia.org', 'wikipedia.com'],
	logo: 'https://en.wikipedia.org/static/favicon/wikipedia.ico',
	detect: url => (url.pathname.startsWith('/wiki/') && {
		article: url.pathname.substr(6), // remove "/wiki/"
		language: url.host.split('.')[0],
		hash: decodeURIComponent(url.hash.substr(1)),
	}),
	async handleLink(href, { language, article, hash }) {
		// Fix links with a www, or no lang code. These default to en
		if (language === 'www' || language === 'wikipedia') language = 'en';

		// `article` is a path segment off a link on the page, and it was dropped
		// into the query string raw. Two things follow from that. A pathname may
		// contain `&`, so `/wiki/Foo&action=query&…` appended parameters of its own
		// to a MediaWiki call that takes last-wins; and a `+` in a title (`/wiki/C++`)
		// decodes to a space on the far side, so the C++ article never resolved.
		const page = encodeURIComponent(article);

		// If there's a hash, look up its section number
		const { index: sectionId = 0 } = hash && (await req(`https://${language}.wikipedia.org/w/api.php?action=parse&format=json&prop=sections&page=${page}&origin=*`)).parse.sections.find(({ anchor }) => anchor === hash) || {};

		const { parse: html } = await req(`https://${language}.wikipedia.org/w/api.php?action=parse&format=json&prop=text|displaytitle&section=${sectionId}&page=${page}&origin=*`);

		// Clean up returned html
		// DOMParser won't preload linked resources
		const cleanDoc = new DOMParser().parseFromString(html.text['*'], 'text/html');

		// Remove unwanted sections
		for (const e of cleanDoc.querySelectorAll('.metadata, .hatnote, .mw-editsection, .mw-ext-cite-error, .mwe-math-mathml-inline, .reference, .references')) e.remove();

		// Update all links to use the article's URL as baseURL
		for (const e of cleanDoc.querySelectorAll('a')) {
			e.href = new URL(e.getAttribute('href'), `https://${language}.wikipedia.org/wiki/${article}`).href;
		}

		return {
			type: 'TEXT',
			// `displaytitle` is real markup - MediaWiki italicises species names and
			// book titles there - and this wants the text out of it. The old spelling
			// assigned it to a detached `<div>` and read `textContent` back, which is
			// the DOM-XSS this repo already fixed once in commentPreview's wiki table
			// of contents: a detached node still has an owner document, so
			// `<img src=x onerror=…>` becomes a live element and the handler runs.
			//
			// `decodeEntitiesAsText` is the wrong tool here - it would leave `<i>` in
			// the title as literal text. A `DOMParser` document is inert: it runs no
			// script and loads no resource, so the tags come off with nothing else
			// happening. The body six lines up is parsed the same way for the same
			// reason.
			title: titleText(html.displaytitle || html.title),
			src: cleanDoc.body.innerHTML,
		};
	},
});
