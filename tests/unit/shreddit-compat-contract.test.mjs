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

// jsdom implements `customElements`, so `whenDefined` and `upgrade` are the real
// ones here.
// `attachAfter: null` means it never attaches one at all. Scheduling a very long
// timer instead would keep this file's test process alive until it fired — which
// it did, at 100 seconds, and turned a 3-second file into a 101-second one.
function defineOnce(name, attachAfter) {
	if (customElements.get(name)) return;
	customElements.define(name, class extends HTMLElement {
		connectedCallback() {
			if (this.shadowRoot || attachAfter === null) return;
			// A host that attaches its root well after it was first seen. One
			// `requestAnimationFrame` — what this used to do — misses this entirely,
			// and so did a MutationObserver and three seconds of polling in the three
			// other extensions that hit the same race.
			setTimeout(() => {
				this.attachShadow({ mode: 'open' }).innerHTML = '<div class="action-row"><button data-action-bar-action="upvote">up</button></div>';
			}, attachAfter);
		}
	});
}

test('a shadow root that attaches late still gets the stylesheet', async () => {
	defineOnce('shreddit-post', 120);

	const post = document.createElement('shreddit-post');
	document.body.append(post);
	Shreddit.prepareShredditThing(post);

	// The point of the test: nothing is there yet, so a single-frame retry would
	// have already given up by now.
	assert.equal(post.shadowRoot, null, 'the root attached immediately, so this measures nothing');

	await new Promise(resolve => { setTimeout(resolve, 600); });
	const style = post.shadowRoot && post.shadowRoot.querySelector(`style[${Shreddit.SHREDDIT_SHADOW_STYLE_ATTR}="classic"]`);
	assert.ok(style, 'the stylesheet never landed on a root that attached a few ticks late');
	post.remove();
});

test('a host that never grows a shadow root stops retrying', async () => {
	// The bound matters as much as the retry: an unbounded chain on a renderer
	// that streams hundreds of hosts is a timer per host for the life of the page.
	defineOnce('rsm-never-attaches', null);

	const host = document.createElement('rsm-never-attaches');
	document.body.append(host);
	Shreddit.registerShadowStyle('never', 'div{}', 'rsm-never-attaches');
	Shreddit.prepareShredditThing(host);

	// Longer than the whole retry schedule, so a chain that failed to stop would
	// still be running when this returns.
	await new Promise(resolve => { setTimeout(resolve, 800); });
	assert.equal(host.shadowRoot, null);
	host.remove();
});

test('current Reddit post controls receive the layout-gated stylesheet on every palette', () => {
	const post = document.createElement('shreddit-post');
	post.attachShadow({ mode: 'open' }).innerHTML = `
		<div class="action-row shreddit-post-container">
			<span><shreddit-vote-animations><span class="rpl-vote-button-group">
				<button data-action-bar-action="upvote"><svg icon-name="upvote-outline"></svg></button>
				<span part="reddit-score">42</span>
			</span></shreddit-vote-animations></span>
			<a data-action-bar-action="comments">comments</a>
			<shreddit-post-share-button></shreddit-post-share-button>
		</div>`;
	document.body.append(post);
	Shreddit.prepareShredditThing(post);
	const style = post.shadowRoot.querySelector(`style[${Shreddit.SHREDDIT_SHADOW_STYLE_ATTR}="classic"]`);
	assert.ok(style, 'the open post shadow root needs the layout bridge');
	// The gate is the refined-layout toggle, not the Classic palette: this was
	// `--classic.--refined` until v0.45.0, which left the ten dark palettes with
	// no vote rail inside the shadow root. `theme-parity-contract` holds the rest.
	assert.match(style.textContent, /:host-context\(html\.res-pageTheme\.res-pageTheme--refined\)/);
	assert.doesNotMatch(style.textContent, /res-pageTheme--classic/);
	assert.match(style.textContent, /data-action-bar-action='upvote'/);
	assert.doesNotMatch(style.textContent, /var\(--rsm-th-/, 'palette paint belongs in the shared ::part() sheet');
	assert.match(post.shadowRoot.querySelector('[data-action-bar-action="upvote"]').getAttribute('part'), /\brsm-vote-button\b/);
	assert.match(post.shadowRoot.querySelector('[icon-name]').getAttribute('part'), /\brsm-action-icon\b/);
	assert.match(post.shadowRoot.querySelector('.rpl-vote-button-group > span').getAttribute('part'), /\breddit-score\b.*\brsm-score\b/);
	assert.match(post.shadowRoot.querySelector('shreddit-post-share-button').getAttribute('exportparts'), /share-button:rsm-share-button/);
	assert.equal(post.shadowRoot.querySelectorAll(`style[${Shreddit.SHREDDIT_SHADOW_STYLE_ATTR}="classic"]`).length, 1);
	Shreddit.prepareShredditThing(post);
	assert.equal(post.shadowRoot.querySelectorAll(`style[${Shreddit.SHREDDIT_SHADOW_STYLE_ATTR}="classic"]`).length, 1, 're-preparing streamed posts must not duplicate CSS');
	post.remove();
});

test('current Reddit comment scores are exposed without a per-comment stylesheet', () => {
	const comment = document.createElement('shreddit-comment');
	comment.attachShadow({ mode: 'open' }).innerHTML = '<div data-testid="comment-sub-header"><faceplate-number>9</faceplate-number></div>';
	document.body.append(comment);
	Shreddit.prepareShredditThing(comment);
	const score = comment.shadowRoot.querySelector('faceplate-number');
	assert.match(score.getAttribute('part'), /\brsm-score\b/);
	assert.equal(comment.shadowRoot.querySelector(`[${Shreddit.SHREDDIT_SHADOW_STYLE_ATTR}]`), null);
	comment.remove();
});

test('current Reddit discussion controls expose stable paint hooks', () => {
	const comment = document.createElement('shreddit-comment');
	const action = document.createElement('shreddit-comment-action-row');
	action.attachShadow({ mode: 'open' }).innerHTML = `
		<span class="rpl-vote-button-group">
			<button upvote><svg icon-name="upvote"></svg></button>
			<faceplate-number>9</faceplate-number>
			<button downvote><svg icon-name="downvote"></svg></button>
		</span>`;
	const award = document.createElement('award-button');
	award.attachShadow({ mode: 'open' }).innerHTML = '<button data-award-button><svg data-award-icon></svg></button>';
	const composer = document.createElement('faceplate-textarea-input');
	composer.attachShadow({ mode: 'open' }).innerHTML = `
		<label><span class="input-boundary-box"><span class="input-container"><span class="text-area-wrapper"><textarea></textarea></span></span></span></label>`;
	comment.append(action, award, composer);
	document.body.append(comment);

	Shreddit.prepareShredditThing(comment);

	assert.match(action.shadowRoot.querySelector('[upvote]').getAttribute('part'), /\brsm-vote-button\b/);
	assert.match(action.shadowRoot.querySelector('faceplate-number').getAttribute('part'), /\brsm-vote-score\b/);
	assert.match(action.shadowRoot.querySelector('svg').getAttribute('part'), /\brsm-action-icon\b/);
	assert.match(award.shadowRoot.querySelector('button').getAttribute('part'), /\brsm-comment-action-button\b/);
	assert.match(award.shadowRoot.querySelector('svg').getAttribute('part'), /\brsm-award-icon\b/);
	assert.match(composer.shadowRoot.querySelector('label').getAttribute('part'), /\brsm-comment-composer-shell\b/);
	assert.match(composer.shadowRoot.querySelector('.input-boundary-box').getAttribute('part'), /\brsm-comment-composer-boundary\b/);
	assert.match(composer.shadowRoot.querySelector('textarea').getAttribute('part'), /\brsm-comment-composer-input\b/);
	comment.remove();
});

test('current Reddit shadow paint hooks survive late rendering and rerenders', async () => {
	const action = document.createElement('shreddit-comment-action-row');
	action.attachShadow({ mode: 'open' });
	document.body.append(action);
	Shreddit.prepareShredditTree(action);

	action.shadowRoot.innerHTML = '<span class="rpl-vote-button-group"><button upvote></button></span>';
	await new Promise(resolve => { setTimeout(resolve, 0); });
	assert.match(action.shadowRoot.querySelector('[upvote]').getAttribute('part'), /\brsm-vote-button\b/);

	action.shadowRoot.innerHTML = '<span class="rpl-vote-button-group"><button downvote></button></span>';
	await new Promise(resolve => { setTimeout(resolve, 0); });
	assert.match(action.shadowRoot.querySelector('[downvote]').getAttribute('part'), /\brsm-vote-button\b/);
	action.remove();
});

test('current Reddit tree preparation sweeps nested shadow hosts once', () => {
	const root = document.createElement('div');
	let parent = root;
	for (const depth of Array.from({ length: 20 }, (_, index) => index)) {
		const comment = document.createElement('shreddit-comment');
		comment.setAttribute('depth', String(depth));
		const action = document.createElement('shreddit-comment-action-row');
		action.attachShadow({ mode: 'open' });
		comment.append(action);
		parent.append(comment);
		parent = comment;
	}
	document.body.append(root);

	const original = Element.prototype.querySelectorAll;
	let sharedShadowSweeps = 0;
	Element.prototype.querySelectorAll = function querySelectorAll(selector) {
		if (String(selector).includes('shreddit-comment-action-row')) sharedShadowSweeps += 1;
		return Reflect.apply(original, this, [selector]);
	};
	try {
		Shreddit.prepareShredditTree(root);
	} finally {
		Element.prototype.querySelectorAll = original;
		root.remove();
	}
	assert.equal(sharedShadowSweeps, 1, 'nested comments must share one auxiliary shadow-host sweep');
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

	comment.querySelector('details').setAttribute('open', '');
	comment.setAttribute('collapsed', '');
	Shreddit.prepareShredditThing(comment);
	assert.equal(comment.classList.contains('collapsed'), true);
	comment.setAttribute('collapsed', 'false');
	Shreddit.prepareShredditThing(comment);
	assert.equal(comment.classList.contains('collapsed'), false);
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
	assert.match(scss, /reddit-header-large reddit-header-action-items > header/);
	assert.match(scss, /comment-body-header > div:has\(> shreddit-comments-sort-dropdown\)/);
	assert.match(scss, /pdp-comment-search-input::part\(rsm-comment-search-button\)/);
	assert.match(scss, /#left-sidebar-container/);
	assert.match(scss, /shreddit-feed shreddit-post/);
	assert.match(scss, /shreddit-comment\[depth='0'\]/);
	assert.match(scss, /--shreddit-color-wordmark:\s*var\(--rsm-th-txt-strong\)/);
	assert.match(scss, /shreddit-post:not\(\[view-context='CommentsPage'\]\) \[slot='post-media-container'\]/);
	assert.match(scss, /shreddit-post:not\(\[view-context='CommentsPage'\]\) shreddit-player/);
	const bridge = read('lib/utils/shreddit.js');
	assert.match(bridge, /svg\[icon-name\]/);
	assert.match(bridge, /share-button:rsm-share-button/);
	assert.match(scss, /shreddit-post::part\(rsm-share-button\)/);
	assert.match(bridge, /vote-icon-outline/);
	const listing = read('tests/fixtures/shreddit/listing.html');
	assert.match(listing, /rpl-action-bar>[\s\S]*?class="shreddit-post-container"[\s\S]*?rpl-vote-button-group/);
	assert.match(listing, /icon-name="upvote-outline"[\s\S]*?icon-name="downvote-outline"[\s\S]*?icon-name="comment-outline"[\s\S]*?icon-name="share-outline"/);
	assert.match(listing, /https:\/\/preview\.redd\.it\/media00000001\.png/);
	assert.match(listing, /https:\/\/v\.redd\.it\/media00000002\.mp4/);
	assert.doesNotMatch(listing, /data-fixture-icon|media preview/);
	assert.ok(fs.statSync(path.join(repoRoot, 'tests', 'fixtures', 'media', 'fixture-video.mp4')).size > 1_000, 'the video fixture should contain decodable media');

	for (const file of ['chrome/manifest.json', 'firefox/manifest.json']) {
		const manifest = JSON.parse(read(file));
		const exclusions = manifest.content_scripts[0].exclude_matches || [];
		assert.ok(!exclusions.includes('https://sh.reddit.com/*'), `${file} must run on Shreddit`);
	}
});
