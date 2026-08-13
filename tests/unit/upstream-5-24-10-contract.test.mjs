import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadModule } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('combined-search text posts normalize their entry and expose the post link', async () => {
	const html = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body class="combined-search-page">
		<main class="content" role="main">
			<div class="search-result-link" data-url="https://example.com/fallback">
				<a class="search-title" href="https://old.reddit.com/r/example/comments/abc/text_post/">Text-only result</a>
			</div>
		</main>
	</body></html>`;
	const { Thing } = await loadModule('lib/utils/Thing.js', 'upstream-search-result', {
		dom: { url: 'https://old.reddit.com/search?q=text', html },
		stubEnvironment: true,
	});
	const row = document.querySelector('.search-result-link');
	const thing = Thing.checkedFrom(row);
	assert.equal(thing.entry, row);
	assert.equal(row.classList.contains('entry'), true, 'search-row fallback should be normalized for entry consumers');
	assert.equal(thing.getPostLink().className, 'search-title');
	assert.equal(thing.getPostLink().pathname, '/r/example/comments/abc/text_post/');
});

test('Bluesky accepts trailing-slash posts and degrades private oEmbeds safely', async () => {
	const { __targetDefault: bluesky } = await loadModule('lib/modules/hosts/bluesky.js', 'upstream-bluesky', {
		stubEnvironment: true,
		exportDefault: true,
	});
	const href = 'https://bsky.app/profile/did:plc:abc123/post/3kabc123/';
	assert.ok(bluesky.detect(new URL(href)), 'a valid trailing slash must not suppress the expando');

	// The stubbed oEmbed boundary rejects, matching a private/login-required post.
	const media = await bluesky.handleLink(href);
	assert.equal(media.type, 'GENERIC_EXPANDO');
	const element = media.generate();
	media.onAttach();
	assert.equal(element.tagName, 'BLOCKQUOTE');
	assert.equal(element.textContent, 'blueskyExpandoUnavailable');
	assert.match(element.className, /bluesky-embed--unavailable/);

	const locale = JSON.parse(fs.readFileSync(path.join(repoRoot, 'locales/locales/en.json'), 'utf8'));
	assert.match(locale.blueskyExpandoUnavailable.message, /could not be embedded/i);
});
