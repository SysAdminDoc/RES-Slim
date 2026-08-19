/* @flow */

import { markdown, markdownWiki } from 'snudown-js';
import { debounce, once } from '../utils/functional';
import { Module } from '../core/module';
import { isRunning } from '../core/modules/modules';
import { buildCodeBlockHtml, splitFences } from '../utils/fencedCode';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import type { RedditStylesheet } from '../types/reddit';
import { ajax } from '../environment';
import {
	NAMED_KEYS,
	checkKeysForEvent,
	currentSubreddit,
	decodeEntitiesAsText,
	downcast,
	isPageType,
	string,
	empty,
} from '../utils';
import * as CommentTools from './commentTools';
import { module as fencedCodeBlocks } from './fencedCodeBlocks';
import * as SettingsNavigation from './settingsNavigation';

export const module: Module<*> = new Module('commentPreview');

module.moduleName = 'commentPrevName';
module.category = 'commentsCategory';
module.description = 'commentPrevDesc';
module.options = {
	enableBigEditor: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewEnableBigEditorDesc',
		title: 'commentPreviewEnableBigEditorTitle',
	},
	swapBigEditorLayout: {
		type: 'boolean',
		value: false,
		description: 'commentPreviewSwapBigEditorLayoutDesc',
		title: 'commentPreviewSwapBigEditorLayoutTitle',
		bodyClass: true,
	},
	openBigEditor: {
		type: 'keycode',
		value: [69, false, true, false, false], // control-e
		description: 'commentPreviewOpenBigEditorDesc',
		title: 'commentPreviewOpenBigEditorTitle',
	},
	draftStyle: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewDraftStyleDesc',
		title: 'commentPreviewDraftStyleTitle',
		advanced: true,
		bodyClass: true,
	},
	enableForComments: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewEnableForCommentsDesc',
		title: 'commentPreviewEnableForCommentsTitle',
		advanced: true,
	},
	enableForPosts: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewEnableForPostsDesc',
		title: 'commentPreviewEnableForPostsTitle',
		advanced: true,
	},
	enableForWiki: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewEnableForWikiDesc',
		title: 'commentPreviewEnableForWikiTitle',
		advanced: true,
	},
	enableForSubredditConfig: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewEnableForSubredditConfigDesc',
		title: 'commentPreviewEnableForSubredditConfigTitle',
		advanced: true,
	},
	enableForBanMessages: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewEnableForBanMessagesDesc',
		title: 'commentPreviewEnableForBanMessagesTitle',
		advanced: true,
	},
	sidebarPreview: {
		type: 'boolean',
		value: true,
		description: 'commentPreviewSidebarPreviewDesc',
		title: 'commentPreviewSidebarPreviewTitle',
		advanced: true,
	},
};
module.include = [
	'comments',
	'inbox',
	'submit',
	'profile',
	'modqueue',
	'subredditAbout',
	'wiki',
];
module.exclude = [
	'd2x',
	/^\/(?:r\/[\-\w\.]+\/)?wiki\/edit\/config\/automoderator\b/i,
];

const subredditImages = new Map();
let isWiki, isBan;

module.beforeLoad = () => {
	isWiki = isPageType('wiki');
	isBan = (/^https?:\/\/(?:[\-\w\.]+\.)?reddit\.com\/r\/[\-\w\.]+\/about\/banned/i).test(location.href);

	const subreddit = currentSubreddit();
	if (isWiki && subreddit) initWikiImages(subreddit);
};

module.contentStart = () => {
	if (module.options.enableBigEditor.value) {
		document.body.addEventListener('keydown', (e: KeyboardEvent) => {
			if (!(e.target instanceof Element) || !e.target.matches('.usertext-edit textarea, #wiki_page_content')) return;
			if (checkKeysForEvent(e, module.options.openBigEditor.value)) {
				showBigEditor(e);
			}
		});
	}

	if (isWiki) {
		attachWikiPreview();
		addBigEditorButton(document.querySelector('.markhelp'));
	} else {
		document.body.addEventListener('focus', (e: Event) => {
			if (e.target instanceof HTMLElement && e.target.matches(CommentTools.commentTextareaSelector)) {
				addBigEditorButton(e.target);
				attachPreview(e.target);
			}
		}, true);
	}
};

async function initWikiImages(subreddit) {
	const { data } = (await ajax({
		url: `/r/${subreddit}/about/stylesheet.json`,
		type: 'json',
	}): RedditStylesheet);

	if (data && data.images) {
		for (const { name, url } of data.images) {
			subredditImages.set(name, url);
		}
	}
}

// snudown is built without fenced-code support, so a triple-backtick block came
// out as `<p><code>` — while `fencedCodeBlocks` renders the same text on the page
// as `<pre><code>`. The preview and the page disagreed about the one construct
// that module exists for. The fences are rendered here by the page's own builder
// and the prose between them still goes through snudown.
function renderMarkdownWithFences(md, renderProse) {
	const segments = splitFences(md);
	if (!segments.some(segment => segment.type === 'fence')) return renderProse(md);

	const highlight = isRunning(fencedCodeBlocks) && fencedCodeBlocks.options.highlight.value;
	return segments
		.map(segment => (segment.type === 'fence' ?
			buildCodeBlockHtml(segment.lang, segment.content, highlight) :
			renderProse(segment.content)))
		.join('');
}

function markdownToHTML(md) {
	if (isBan && md.length) {
		md = generateBanMessage(md, currentSubreddit() || '');
	}

	if (!isWiki) {
		return renderMarkdownWithFences(md, markdown);
	} else {
		// SnuOwnd created this HTML from markdown so it is safe.
		const doc = new DOMParser().parseFromString(`<body>${markdownWiki(md)}</body>`, 'text/html');
		const docBody = doc.body;

		for (const img: HTMLImageElement of (docBody.querySelectorAll('img'): any)) {
			const src = img.getAttribute('src');
			const imgKey = src && src.startsWith('%%') && src.endsWith('%%') && src.slice('%%'.length, -'%%'.length);
			const resolvedSrc = imgKey && subredditImages.get(imgKey);

			if (resolvedSrc) {
				img.src = resolvedSrc;
			} else {
				img.remove();
			}
		}

		const headerIds = new Map();
		const headers = docBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
		const tocDiv = document.createElement('div');
		tocDiv.className = 'toc';
		let parentUl = document.createElement('ul');
		parentUl.dataset.level = '1';
		tocDiv.appendChild(parentUl);
		let level = 1;
		let previous = 1;
		const prefix = 'wiki';
		for (const header of headers) {
			const contents = header.textContent;
			// Decodes entities without a live parse; see decodeEntitiesAsText for why
			// a <div> here would be DOM-XSS reachable from any wiki heading.
			let aid = decodeEntitiesAsText(contents);
			aid = `${prefix}_${aid.replace(/ /g, '_').toLowerCase()}`;
			aid = aid.replace(/[^\w\.\-]/g, s => `.${s.charCodeAt(0).toString(16).toUpperCase()}`);
			const idNum = (headerIds.get(aid) || 0) + 1;
			headerIds.set(aid, idNum);

			if (idNum > 1) {
				aid += idNum;
			}

			header.id = aid;

			const li = document.createElement('li');
			li.className = aid;
			const a = document.createElement('a');
			a.href = `#${aid}`;
			a.textContent = contents;
			li.appendChild(a);

			const thisLevel = +header.tagName.slice(-1);
			if (thisLevel > previous) {
				const newUL = document.createElement('ul');
				newUL.dataset.level = String(thisLevel);
				parentUl.appendChild(newUL);
				parentUl = newUL;
				level++;
			} else if (thisLevel < previous) {
				while (level > 1 && parseInt(parentUl.dataset.level, 10) > thisLevel) {
					parentUl = (parentUl.parentElement: any);
					level--;
				}
			}
			previous = thisLevel;
			parentUl.appendChild(li);
		}
		docBody.prepend(tocDiv);
		return docBody.innerHTML;
	}
}

const addBigEditorButton = ele => {
	if (!module.options.enableBigEditor.value) return;

	const container = ele.closest('#editform, .usertext-edit, #banned');
	if (!container) return;

	const bigEditorButton = container.querySelector('.RESBigEditorPop') || string.html`
		<button type="button" class="RESBigEditorPop" tabIndex="3">
			<span class="res-icon res-icon-12">&#xF0A4;</span> big editor
		</button>
	`;

	if (isBan || isWiki) {
		ele.after(bigEditorButton);
	} else {
		const bottom = container.querySelector('.bottom-area');
		bottom.prepend(bigEditorButton);
	}

	bigEditorButton.addEventListener('click', showBigEditor);
};

const attachPreview = textarea => {
	if (
		!module.options.enableForComments.value && textarea.closest('.commentarea, .message') ||
		!module.options.enableForPosts.value && (isPageType('submit') || textarea.closest('.link')) ||
		!module.options.enableForSubredditConfig.value && (/^\/r\/[\-\w.]+\/about\/edit/i).test(location.pathname) ||
		!module.options.enableForBanMessages.value && isBan
	) {
		return;
	}

	const container = textarea.closest('.usertext-edit, #banned');
	if (!container) return;

	const preview = container.querySelector('.livePreview') || makePreviewBox();

	const elements = [preview.querySelector('.RESDialogContents')];
	if (module.options.sidebarPreview.value && textarea.getAttribute('name') === 'description') {
		elements.push(document.querySelector('.side .usertext-body .md'));
	}

	textarea.addEventListener('input', debounce(() => onTextareaInput(textarea, preview, elements), 100));

	// trigger initial render in case the textarea already has text in it
	onTextareaInput(textarea, preview, elements);

	// Close on submit
	const form = textarea.closest('form');
	if (form) {
		form.addEventListener('submit', () => {
			preview.remove();
		});
	}

	container.append(preview);
};

function attachWikiPreview() {
	if (!module.options.enableForWiki.value) return;

	const preview = makePreviewBox();
	preview.querySelector('.md').classList.add('wiki');
	document.querySelector('#editform > br').after(preview);
	const contents = preview.querySelector('.RESDialogContents');

	const wikiContent = document.getElementById('wiki_page_content');
	if (wikiContent) {
		const handler = debounce(() => onTextareaInput(wikiContent, preview, [contents]), 100);
		wikiContent.addEventListener('input', handler);
		wikiContent.addEventListener('focus', handler);
	}
}

function onTextareaInput(textarea, preview, elements) {
	const markdownText = downcast(textarea, HTMLTextAreaElement).value;

	if (markdownText.length) {
		if (preview) preview.hidden = false;
		for (const ele of elements) setTrustedHTML(ele, markdownToHTML(markdownText));
	} else {
		if (preview) preview.hidden = true;
		for (const ele of elements) empty(ele);
	}
}

function makePreviewBox() {
	return string.html`
		<div class="RESDialogSmall livePreview">
			<h3>Live Preview</h3>
			${string.safe(SettingsNavigation.makeUrlHashLink(module.moduleID, undefined, ' ', 'gearIcon'))}
			<div class="md RESDialogContents"></div>
		</div>
	`;
}

let bigTextTarget;

const createBigEditor = once(() => {
	const editor = document.createElement('div');
	editor.id = 'BigEditor';

	const left = document.createElement('div');
	left.className = 'BELeft RESDialogSmall';
	left.innerHTML = '<h3>Editor</h3>';

	const contents = document.createElement('div');
	contents.className = 'RESDialogContents';
	const textarea = document.createElement('textarea');
	textarea.id = 'BigText';
	textarea.name = 'text';
	contents.appendChild(textarea);

	const foot = document.createElement('div');
	foot.className = 'BEFoot';
	if (!isBan) {
		const saveBtn = document.createElement('button');
		saveBtn.type = 'button';
		saveBtn.textContent = 'save';
		saveBtn.addEventListener('click', () => {
			const len = textarea.value.length;
			const max = parseInt(textarea.dataset.maxLength, 10);
			if (len > max) {
				const errors = editor.querySelectorAll('.errorList .error');
				for (const err of errors) (err: any).style.display = 'none';
				const tooLong = editor.querySelector('.errorList .TOO_LONG');
				if (tooLong) {
					tooLong.textContent = `this is too long (max: ${max})`;
					(tooLong: any).style.display = '';
				}
			} else if (len === 0) {
				const errors = editor.querySelectorAll('.errorList .error');
				for (const err of errors) (err: any).style.display = 'none';
				const noText = editor.querySelector('.errorList .NO_TEXT');
				if (noText) (noText: any).style.display = '';
			} else {
				hideBigEditor(true);
			}
		});
		foot.appendChild(saveBtn);
	}
	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.textContent = 'close';
	closeBtn.addEventListener('click', () => hideBigEditor());
	foot.appendChild(closeBtn);

	const errorList = document.createElement('span');
	errorList.className = 'errorList';
	errorList.innerHTML = '<span style="display: none;" class="error NO_TEXT">we need something here</span><span style="display: none;" class="error TOO_LONG">this is too long (max: 10000)</span>';
	foot.appendChild(errorList);

	contents.appendChild(foot);
	left.appendChild(contents);

	const right = document.createElement('div');
	right.className = 'BERight RESDialogSmall';
	right.innerHTML = '<h3>Preview</h3><div class="RESCloseButton RESCloseButtonTopRight"></div><div class="RESDialogContents"><div id="BigPreview" class=" md"></div></div>';

	editor.append(left, right);

	right.querySelector('.RESCloseButton').addEventListener('click', () => hideBigEditor());

	const bigPreview = right.querySelector('#BigPreview');
	textarea.addEventListener('input', debounce(() => onTextareaInput(textarea, null, [bigPreview]), 100));

	editor.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === NAMED_KEYS.Escape) {
			hideBigEditor();
			e.preventDefault();
			return false;
		}
	});

	return editor;
});

function showBigEditor(e: Event) {
	e.preventDefault();
	const editor = createBigEditor();
	document.body.appendChild(editor);
	document.body.classList.add('RESScrollLock');
	const textarea = editor.querySelector('textarea');
	let baseText;
	if (!isWiki && !isBan) {
		const currentTarget = (e.currentTarget: any) || e.target;
		const usertextEdit = currentTarget.closest('.usertext-edit') || currentTarget.closest('.usertext-edit:first-child');
		baseText = usertextEdit && usertextEdit.querySelector('textarea');

		if (baseText) {
			const limit = baseText.getAttribute('data-limit');
			textarea.setAttribute('data-limit', limit);
		}
		const bigPreview = document.getElementById('BigPreview');
		if (bigPreview) bigPreview.classList.remove('wiki');
		const beRightContents = editor.querySelector('.BERight .RESDialogContents');
		if (beRightContents) beRightContents.classList.remove('wiki-page-content');
	} else if (isBan) {
		baseText = document.getElementById('ban_message');

		if (baseText) {
			const limit = baseText.getAttribute('data-limit');
			textarea.setAttribute('data-limit', limit);
		}
		const bigPreview = document.getElementById('BigPreview');
		if (bigPreview) bigPreview.classList.remove('wiki');
		const beRightContents = editor.querySelector('.BERight .RESDialogContents');
		if (beRightContents) beRightContents.classList.remove('wiki-page-content');
	} else {
		baseText = document.getElementById('wiki_page_content');
		const bigPreview = document.getElementById('BigPreview');
		if (bigPreview) bigPreview.classList.add('wiki');
		const beRightContents = editor.querySelector('.BERight .RESDialogContents');
		if (beRightContents) beRightContents.classList.add('wiki-page-content');
	}

	if (baseText) {
		const md = (baseText: any).value;
		const maxLength = baseText.dataset.maxLength;
		textarea.dataset.maxLength = maxLength;
		textarea.value = md;
		textarea.focus();
		bigTextTarget = baseText;
		textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
	}
}

function hideBigEditor(save: boolean = false) {
	if (!bigTextTarget) throw new Error();

	const editor = createBigEditor();
	const textarea = editor.querySelector('textarea');

	(bigTextTarget: any).value = textarea.value;
	bigTextTarget.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

	if (save) {
		const form = bigTextTarget.closest('form');
		if (form) {
			const submitBtn = form.querySelector('input[type=submit], button[type=submit]');
			if (submitBtn) submitBtn.click();
		}
	} else {
		bigTextTarget.focus();
	}

	// Use native remove method
	editor.remove();
	document.body.classList.remove('RESScrollLock');

	bigTextTarget = null;
}

function generateBanMessage(message, subreddit) {
	return [
		`you have been banned from posting to [/r/${subreddit}](/r/${subreddit}).`,
		'',
		'note from the moderators:',
		'',
		message.replace(/^/gm, '> '),
		'',
		'you can contact the moderators regarding your ban by replying to this message. **warning**: using other accounts to circumvent a subreddit ban is considered a violation of reddit\'s [site rules](/rules) and can result in being banned from reddit entirely.',
	].join('\r\n');
}
