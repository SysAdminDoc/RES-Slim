/* @flow */

import DOMPurify from 'dompurify';
import { once } from '../utils/functional';
import { Module } from '../core/module';
import {
	CreateElement,
	WEEK,
	addDashboardTab,
	formatDate,
	formatDateDiff,
	formatDateTime,
	isPageType,
	preventCloning,
	string,
	watchForThings,
	Thing,
	closestHtml,
} from '../utils';
import { Storage, i18n } from '../environment';
import { loadSnudown } from '../utils/snudown';
import * as Notifications from './notifications';

export const module: Module<{ [string]: any }> = new Module('saveComments');

module.moduleName = 'saveCommentsName';
module.description = 'saveCommentsDesc';
module.category = 'commentsCategory';
module.exclude = [
	'submit',
];

const savedCommentStorage = Storage.wrapFeatureBlob('saveComments', 'RESmodules.saveComments.savedComments', (): {|
	href: string,
	username: string,
	comment: string,
	timeSaved: string,
|} => { throw new Error('Saved comment not found'); });

module.beforeLoad = () => {
	watchForThings(['comment'], thing => {
		const sibling = thing.entry.querySelector('.comment-save-button');
		if (!sibling) return;
		sibling.after(saveElement());
	});
};

module.contentStart = () => {
	if (isPageType('profile')) {
		CreateElement.tabMenuItem({
			text: 'saved - RES',
			onChange: () => { location.href = '/r/dashboard/#savedComments'; },
		});
	}

	addDashboardTab('savedComments', 'Saved Comments', module.moduleID, async tabPage => tabPage.appendChild(await drawSavedComments()));
};

const saveElement = (e => () => preventCloning(e().cloneNode(true)))(once(() => {
	document.body.addEventListener('click', (event: Event) => {
		if (!(event.target instanceof Element) || !event.target.closest('li.saveComments')) return;
		Object.defineProperty(event, 'currentTarget', { value: event.target.closest('li.saveComments') });
		event.preventDefault();
		const { currentTarget } = event;
		if (currentTarget.classList.contains('saved-RES')) return;

		const thing = Thing.checkedFrom(currentTarget);
		saveComment(thing);

		const a = (currentTarget.firstElementChild: any);
		requestAnimationFrame(() => {
			a.dataset.text = 'saved-RES';
			a.href = '/r/dashboard#savedComments';
		});
	});

	return string.html`
		<li class="saveComments">
			<a class="RES-save noCtrlF" href="#" title="Save using RES - which is local only, but preserves the full text in case someone edits/deletes it" data-text="save-RES"></a>
		</li>
	`;
}));

async function saveComment(thing: Thing) {
	const permaLink = thing.getCommentPermalink();
	if (!permaLink) throw new Error('Comment lacks permalink');

	const textBody = thing.getTextBody();
	if (!textBody) throw new Error('Comment text body not found');

	const id = thing.getFullname().split('_').slice(-1)[0];
	if ((await savedCommentStorage.getAll()).hasOwnProperty(id)) return;

	const comment = textBody.cloneNode(true);
	for (const el of comment.querySelectorAll('.keyNavAnnotation, .expando-button, .res-expando-box, script, .userTagLink')) el.remove();

	savedCommentStorage.set(id, {
		href: permaLink.href,
		username: thing.getAuthor() || '[deleted]',
		comment: comment.innerHTML,
		timeSaved: new Date().toString(),
	});
}

const savedCommentsTemplate = ({ comments, keyNavTip, moduleDescription }) => string.html`
	<div id="res-saveComments" class="sitetable linklisting">
		${!comments.length && string._html`
			<div class="res-module-description md">
				<h1>Saving comments with RES</h1>
				${string.safe(moduleDescription)}
			</div>
		`}
		${keyNavTip && keyNavTip.map(({ keyNavHash, savePostKey, saveCommentKey, saveRESKey }) => string._html`
			<div class="res-module-tip infobar">
				<p><i>Keyboard Shortcuts</i> <a class="gearIcon" href="${keyNavHash}" title="RES settings"></a></p>
				<ul>
					<li><b>${savePostKey}</b>: save a submission.</li>
					<li><b>${saveCommentKey}</b>: save a comment (to your reddit account).</li>
					<li><b>${saveRESKey}</b>: save a comment with RES.</li>
				</ul>
			</div>
		`)}
		<div class="res-saveComments-list">
			${comments.map(({ id, link, username, dateTime, date, timeAgo, body }) => string._html`
				<div class="entry res-savedComment">
					<div class="savedCommentHeader">
						<a href="${link}">
							<b>${username}</b>
							- saved <date title="${dateTime}" datetime="${date}">${timeAgo}</date> ago
						</a>
					</div>
					<div class="savedCommentBody md">${string.safe(body)}</div>
					<div class="savedCommentFooter">
						<ul class="flat-list buttons">
							<li><a href="${link}">permalink</a></li>
							<li><a class="unsaveComment" href="#" data-unsaveID="${id}">unsave-RES</a></li>
						</ul>
					</div>
				</div>
			`)}
		</div>
	</div>
`;

const drawSavedComments = once(async () => {
	const savedComments = await savedCommentStorage.getAll();

	const comments = Object.entries(savedComments).map(([id, { comment, href, username, timeSaved }]) => {
		const date = new Date(timeSaved);
		const rawComment = typeof comment === 'string' ? comment : ''; // `undefined` might have been saved at a buggy past.
		return {
			id,
			link: href,
			username,
			date: formatDate(date),
			dateTime: formatDateTime(date),
			timeAgo: formatDateDiff(date),
			body: rawComment ? DOMPurify.sanitize(rawComment) : '',
		};
	});

	const el = savedCommentsTemplate({
		moduleDescription: comments.length ? '' : (await loadSnudown()).markdown(i18n(module.description)),
		keyNavTip: false,
		comments,
	});
	el.addEventListener('click', (e: Event) => {
		const unsaveLink = closestHtml(e.target, '.unsaveComment');
		if (!unsaveLink) return;
		e.preventDefault();
		savedCommentStorage.delete(unsaveLink.dataset.unsaveid);
		unsaveLink.textContent = 'removed';
	});
	return el;
});

export function showEducationalNotification() {
	Notifications.showNotification({
		moduleID: module.moduleID,
		optionKey: 'savePost',
		notificationID: 'saveRES-educational',
		closeDelay: 10000,
		cooldown: 3 * WEEK,
		header: 'Saving Posts and Comments',
		message: `
			<p>Click the <b>save</b> link on a post or comment to save it to your reddit account.</p>
			<p>Click the <b>save-RES</b> link under a comment to save it locally. The text is preserved even if the comment is later edited or deleted.</p>
		`,
	});
}
