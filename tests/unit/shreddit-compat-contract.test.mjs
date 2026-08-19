import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const html = `<!doctype html><html><body>
<shreddit-app>
	<shreddit-post id="t3_post001" author="alice" subreddit-name="example" domain="self.example"
		post-type="text" score="42" comment-count="7" permalink="/r/example/comments/post001/title/"
		content-href="https://www.reddit.com/r/example/comments/post001/title/">
		<span slot="credit-bar"><a href="/r/example/">r/example</a><a href="/user/alice/">alice</a></span>
		<a slot="title" href="/r/example/comments/post001/title/">A stable current Reddit post</a>
		<shreddit-post-flair slot="post-flair">Guide</shreddit-post-flair>
		<shreddit-post-text-body slot="text-body"><div>Post body</div></shreddit-post-text-body>
	</shreddit-post>
	<shreddit-comment thingid="t1_comment1" author="bob" score="9"
		permalink="/r/example/comments/post001/comment/comment1/" depth="0">
		<details open><summary>collapse</summary><div>
			<div slot="commentMeta"><a href="/user/bob/">bob</a><a href="/r/example/comments/post001/comment/comment1/"><time datetime="2026-08-19T12:00:00Z">now</time></a></div>
			<div slot="comment">A useful comment</div><div slot="actionRow"></div>
			<shreddit-comment-author-modifier-icon op></shreddit-comment-author-modifier-icon>
		</div></details>
	</shreddit-comment>
</shreddit-app>
</body></html>`;

const dom = installDom({ url: 'https://www.reddit.com/r/example/comments/post001/title/', html });
Object.defineProperty(globalThis, 'HTMLDetailsElement', { value: dom.window.HTMLDetailsElement, configurable: true });
const Shreddit = await loadFlowModule('lib/utils/shreddit.js', 'shreddit-compat');

test('current Reddit posts are normalised into the Thing vocabulary', () => {
	const prepared = Shreddit.prepareShredditTree(document);
	assert.equal(prepared.length, 2);
	const post = document.querySelector('shreddit-post');
	assert.ok(post.classList.contains('thing'));
	assert.ok(post.classList.contains('link'));
	assert.ok(post.classList.contains('self'));
	assert.equal(post.getAttribute('data-fullname'), 't3_post001');
	assert.equal(post.getAttribute('data-author'), 'alice');
	assert.equal(post.getAttribute('data-subreddit'), 'example');
	assert.equal(post.getAttribute('data-domain'), 'self.example');
	assert.equal(post.getAttribute('data-score'), '42');
	assert.equal(post.getAttribute('data-comments-count'), '7');
	assert.equal(post.querySelector('[slot="title"]').classList.contains('title'), true);
	assert.equal(post.querySelector('a[href="/user/alice/"]').classList.contains('author'), true);
	assert.equal(post.querySelector('[slot="credit-bar"]').classList.contains('tagline'), true);
});

test('current Reddit post controls receive the layout-gated stylesheet on every palette', () => {
	const post = document.createElement('shreddit-post');
	post.attachShadow({ mode: 'open' }).innerHTML = '<div class="action-row"><button data-action-bar-action="upvote">up</button></div>';
	document.body.append(post);
	Shreddit.prepareShredditThing(post);
	const style = post.shadowRoot.querySelector(`style[${Shreddit.SHREDDIT_CLASSIC_STYLE_ATTR}]`);
	assert.ok(style, 'the open post shadow root needs the layout bridge');
	// The gate is the refined-layout toggle, not the Classic palette: this was
	// `--classic.--refined` until v0.45.0, which left the ten dark palettes with
	// no vote rail inside the shadow root. `theme-parity-contract` holds the rest.
	assert.match(style.textContent, /:host-context\(html\.res-pageTheme\.res-pageTheme--refined\)/);
	assert.doesNotMatch(style.textContent, /res-pageTheme--classic/);
	assert.match(style.textContent, /data-action-bar-action='upvote'/);
	assert.equal(post.shadowRoot.querySelectorAll(`style[${Shreddit.SHREDDIT_CLASSIC_STYLE_ATTR}]`).length, 1);
	Shreddit.prepareShredditThing(post);
	assert.equal(post.shadowRoot.querySelectorAll(`style[${Shreddit.SHREDDIT_CLASSIC_STYLE_ATTR}]`).length, 1, 're-preparing streamed posts must not duplicate CSS');
	post.remove();
});

test('current Reddit comments retain native collapse state and semantic roles', () => {
	Shreddit.prepareShredditTree(document);
	const comment = document.querySelector('shreddit-comment');
	assert.ok(comment.classList.contains('thing'));
	assert.ok(comment.classList.contains('comment'));
	assert.equal(comment.getAttribute('data-fullname'), 't1_comment1');
	assert.equal(comment.getAttribute('data-author'), 'bob');
	assert.equal(comment.querySelector('[slot="commentMeta"]').classList.contains('tagline'), true);
	assert.equal(comment.querySelector('[slot="comment"]').classList.contains('md'), true);
	assert.equal(comment.querySelector('[slot="actionRow"]').classList.contains('buttons'), true);
	assert.equal(comment.querySelector('summary').classList.contains('expand'), true);
	assert.equal(comment.querySelector('a.author').classList.contains('submitter'), true);
	assert.equal(comment.classList.contains('collapsed'), false);

	comment.querySelector('details').removeAttribute('open');
	Shreddit.prepareShredditThing(comment);
	assert.equal(comment.classList.contains('collapsed'), true);
});

test('the current renderer participates in page types, watchers, theming, and both manifests', () => {
	const location = read('lib/utils/location.js');
	const watcher = read('lib/utils/watchers_d2x.js');
	const thing = read('lib/utils/Thing.js');
	const theme = read('lib/modules/pageTheme.js');
	const scss = read('lib/css/modules/_pageTheme.scss');

	assert.match(location, /d2x:\s*\{[\s\S]*?default: 'linklist'/);
	assert.match(location, /d2x:\s*\{[\s\S]*?'comments'/);
	assert.match(watcher, /new MutationObserver/);
	assert.match(watcher, /reddit\.urlChanged/);
	assert.match(watcher, /prepareShredditTree/);
	assert.match(watcher, /thing\.runTasks\(\)/);
	assert.match(thing, /SHREDDIT_THING_SELECTOR/);
	assert.match(thing, /data-action-bar-action="\$\{action\}"/);
	assert.match(theme, /module\.include = \['r2', 'd2x'\]/);
	assert.match(scss, /html\.res-pageTheme:has\(shreddit-app\)/);
	assert.match(scss, /#left-sidebar-container/);
	assert.match(scss, /shreddit-feed shreddit-post/);
	assert.match(scss, /shreddit-comment\[depth='0'\]/);

	for (const file of ['chrome/manifest.json', 'firefox/manifest.json']) {
		const manifest = JSON.parse(read(file));
		const exclusions = manifest.content_scripts[0].exclude_matches || [];
		assert.ok(!exclusions.includes('https://sh.reddit.com/*'), `${file} must run on Shreddit`);
	}
});
