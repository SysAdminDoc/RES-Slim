// The wikipedia expando builds a MediaWiki query from a link on the page and
// renders the response.
//
// Two things were wrong with that, and one of them is visible to any user who
// has ever posted a link to the C++ article. The article name came off the URL
// pathname and went into the query string raw:
//
//   * MediaWiki decodes `+` in a query value as a space, so `/wiki/C++` asked for
//     the article "C  " and the expando showed nothing useful;
//   * a pathname may contain `&`, so `/wiki/Foo&action=query&list=...` appended
//     parameters of its own to a call the API resolves last-wins.
//
// And `displaytitle` is markup that the handler wanted as text, so it assigned it
// to a detached `<div>` and read `textContent` back. A detached node still has an
// owner document: `<img src=x onerror=...>` becomes a live element and the handler
// runs. This repo already fixed that exact pattern once, in commentPreview's wiki
// table of contents; the tool it wrote there, `decodeEntitiesAsText`, is the wrong
// one here, because a title legitimately contains `<i>` and that has to come off
// rather than be shown. A `DOMParser` document is inert - no script, no resource
// loads - so it strips the tags with nothing else happening.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/' });

const { __targetDefault: wikipedia } = await loadModule('lib/modules/hosts/wikipedia.js', 'wikipedia-host', {
	stubEnvironment: true,
	exportDefault: true,
});

// Answer both requests the handler makes and record the URLs it asked for.
function withApi(responses) {
	const asked = [];
	globalThis.__resSlimAjax = ({ url }) => {
		asked.push(url);
		const reply = responses.shift();
		if (!reply) throw new Error(`unexpected extra request: ${url}`);
		return Promise.resolve(reply);
	};
	return { asked, restore() { delete globalThis.__resSlimAjax; } };
}

const parsed = (title, body = '<p>body</p>') => ({
	parse: { displaytitle: title, title, text: { '*': body } },
});

test('the article name is encoded, so a plus sign is not read as a space', async () => {
	const api = withApi([parsed('C++')]);
	try {
		await wikipedia.handleLink(
			'https://en.wikipedia.org/wiki/C++',
			wikipedia.detect(new URL('https://en.wikipedia.org/wiki/C++')),
		);
	} finally {
		api.restore();
	}
	assert.equal(api.asked.length, 1);
	assert.ok(api.asked[0].includes('page=C%2B%2B'), `expected an encoded page parameter, got ${api.asked[0]}`);
});

test('a non-ASCII title is encoded once, not twice', async () => {
	// `URL.pathname` is already percent-encoded, so encoding it straight produced
	// `Caf%25C3%25A9` and asked MediaWiki for an article that does not exist. That
	// is every title on every non-English Wikipedia, plus every accented one on
	// the English site. The first draft of the encoding fix had exactly this bug
	// and the two cases below the test then covered - `C++` and `Foo` - are both
	// pure ASCII, so neither could see it.
	// Sequential: each pass installs its own stub on the shared global and reads
	// back what that one call asked for, so they cannot overlap.
	/* eslint-disable no-await-in-loop */
	for (const [title, expected] of [
		['Café', 'Caf%C3%A9'],
		['日本', '%E6%97%A5%E6%9C%AC'],
		['Привет', '%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82'],
	]) {
		const href = `https://en.wikipedia.org/wiki/${title}`;
		const api = withApi([parsed(title)]);
		try {
			await wikipedia.handleLink(href, wikipedia.detect(new URL(href)));
		} finally {
			api.restore();
		}
		assert.ok(api.asked[0].includes(`page=${expected}`),
			`expected page=${expected}, got ${api.asked[0]}`);
		assert.ok(!api.asked[0].includes('%25'), `the title was encoded twice: ${api.asked[0]}`);
	}
	/* eslint-enable no-await-in-loop */
});

test('a malformed escape in the path does not throw', async () => {
	const href = 'https://en.wikipedia.org/wiki/100%_orange_juice';
	const api = withApi([parsed('100% orange juice')]);
	try {
		await wikipedia.handleLink(href, wikipedia.detect(new URL(href)));
	} finally {
		api.restore();
	}
	assert.equal(api.asked.length, 1, 'the request should still have been made');
});

test('an ampersand in the path cannot append a parameter of its own', async () => {
	const hostile = 'https://en.wikipedia.org/wiki/Foo&action=query&list=allusers';
	const api = withApi([parsed('Foo')]);
	try {
		await wikipedia.handleLink(hostile, wikipedia.detect(new URL(hostile)));
	} finally {
		api.restore();
	}
	const url = api.asked[0];
	// One `action`, and it is the one this handler chose.
	assert.equal((url.match(/[?&]action=/g) || []).length, 1);
	assert.ok(url.includes('action=parse'));
	assert.ok(!url.includes('&list=allusers'), `the injected parameter survived: ${url}`);
	assert.ok(url.includes('page=Foo%26action%3Dquery%26list%3Dallusers'));
});

test('the title has its markup stripped without a live element ever existing', async () => {
	// MediaWiki italicises species names and book titles in `displaytitle`, so
	// stripping the tags is the point. Doing it by assigning to a detached div is
	// what made it dangerous: a detached node still has an owner document.
	let fired = false;
	globalThis.__wikipediaTitleProbe = () => { fired = true; };

	const api = withApi([parsed('<i>Panthera leo</i><img src="x" onerror="window.__wikipediaTitleProbe()">')]);
	let media;
	try {
		media = await wikipedia.handleLink(
			'https://en.wikipedia.org/wiki/Foo',
			wikipedia.detect(new URL('https://en.wikipedia.org/wiki/Foo')),
		);
	} finally {
		api.restore();
		delete globalThis.__wikipediaTitleProbe;
	}

	assert.equal(media.title, 'Panthera leo', 'the tags come off and the text stays');
	assert.equal(fired, false);
});

test('handling a link never builds a node in the live document', async () => {
	// jsdom does not fetch images, so nothing can be asserted about `onerror`
	// firing - it stays quiet against both implementations, which is exactly how a
	// security test ends up proving nothing. What *is* observable is the mechanism:
	// the old spelling called `document.createElement('div')` on the page's own
	// document and set `innerHTML` on the result. The replacement parses into an
	// inert document instead, so the page document is never touched.
	const created = [];
	const realCreateElement = document.createElement.bind(document);
	document.createElement = (name, ...rest) => {
		created.push(String(name).toLowerCase());
		return realCreateElement(name, ...rest);
	};

	const api = withApi([parsed('<i>Panthera leo</i>')]);
	try {
		await wikipedia.handleLink(
			'https://en.wikipedia.org/wiki/Foo',
			wikipedia.detect(new URL('https://en.wikipedia.org/wiki/Foo')),
		);
	} finally {
		api.restore();
		document.createElement = realCreateElement;
	}

	assert.deepEqual(created, [], `the handler built ${created.join(', ')} in the page document`);
});

test('detect only fires on an article path', () => {
	assert.equal(wikipedia.detect(new URL('https://en.wikipedia.org/wiki/Foo')).article, 'Foo');
	assert.equal(wikipedia.detect(new URL('https://en.wikipedia.org/w/index.php?title=Foo')), false);
	assert.equal(wikipedia.detect(new URL('https://en.wikipedia.org/')), false);
});
