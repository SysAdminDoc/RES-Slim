/* @flow */

import { once } from '../utils/functional';
import { Module } from '../core/module';
import { ajax } from '../environment';
import { closestHtml, watchForThings, regexes, keyedMutex, preventCloning, string } from '../utils';

export const module: Module<*> = new Module('sourceSnudown');

module.moduleName = 'sourceSnudownName';
module.description = 'sourceSnudownDesc';
// Scoped to old reddit. With no include, no exclude and no shouldRun this ran on
// every page the content script touches, including the extension's own options
// page — the same omission fixed one module at a time in v0.3.5 and v0.4.0.
module.include = ['r2'];
module.category = 'commentsCategory';

module.beforeLoad = () => {
	watchForThings(['post', 'comment', 'message'], attachViewSourceButton);
};

const sourceButton = (e => () => preventCloning(e().cloneNode(true)))(once(() => {
	document.body.addEventListener('click', (e: Event) => {
		const viewSourceLink = closestHtml(e.target, 'li.viewSource a');
		if (viewSourceLink) {
			e.preventDefault();
			viewSource(viewSourceLink);
		}
		const cancelBtn = closestHtml(e.target, '.usertext-edit.viewSource .cancel');
		if (cancelBtn) {
			const viewSourceEdit = closestHtml(cancelBtn, '.usertext-edit.viewSource');
			if (viewSourceEdit) viewSourceEdit.style.display = 'none';
		}
	});

	return string.html`
		<li class="viewSource">
			<a class="noCtrlF" href="#" data-text="source"></a>
		</li>
	`;
}));

function attachViewSourceButton(thing) {
	// Link posts don't have any source
	if (thing.isLinkPost()) return;

	const buttons =
		// .first is the first button after NSFW/spoiler stamps
		thing.entry.querySelector('.flat-list.buttons > li.first') ||
		// but some pages (inbox) don't have the .first class
		thing.entry.querySelector('.flat-list.buttons > li');
	if (buttons) buttons.after(sourceButton());
}

const viewSource = keyedMutex(async button => {
	const buttonList = button.closest('ul');
	if (button.dataset.sourceOpen) {
		// `.closest()` is nullable and this dereferenced it straight into
		// `.querySelector`, so a button outside a `.thing` would have thrown rather
		// than done nothing.
		const thing = closestHtml(button, '.thing');
		const viewSourceEdit = thing && thing.querySelector('.usertext-edit.viewSource');
		if (viewSourceEdit) {
			viewSourceEdit.style.display = viewSourceEdit.style.display === 'none' ? '' : 'none';
		}
	} else {
		const bylink = buttonList.querySelector('a.bylink, .first a');
		const path = bylink ? bylink.pathname : '';

		const response = await ajax({
			url: `${path}.json`,
			query: { raw_json: 1 },
			type: 'json',
		});

		const userTextForm = document.createElement('div');
		userTextForm.className = 'usertext-edit viewSource';
		userTextForm.innerHTML = '<div><textarea rows="1" cols="1" name="text" readonly></textarea></div><div class="bottom-area"><div class="usertext-buttons"><button type="button" class="cancel">hide</button></div></div>';
		const textarea = userTextForm.querySelector('textarea');
		textarea.addEventListener('dblclick', () => { textarea.removeAttribute('readonly'); }, { once: true });

		let sourceText;

		if (regexes.commentPermalink.test(path)) {
			sourceText = response[1].data.children[0].data.body;
		} else if (regexes.comments.test(path)) {
			sourceText = response[0].data.children[0].data.selftext;
		} else {
			const postId: string = ((/\/(\w*)\/?$/).exec(path): any)[1];
			const data = response.data.children[0].data;
			if (data.id === postId) {
				sourceText = data.body;
			} else {
				// The message we want is a reply to a PM/modmail, but reddit returns the whole thread.
				// So, we have to dig into the replies to find the message we want.
				sourceText = data.replies.data.children.find(({ data: { id } }) => id === postId).data.body;
			}
		}

		textarea.textContent = sourceText;
		buttonList.before(userTextForm);
		button.dataset.sourceOpen = 'true';
	}
});
