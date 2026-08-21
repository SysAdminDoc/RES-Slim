/* @flow */

import { once, memoize, debounce } from '../utils/functional';
import { Module } from '../core/module';
import * as Options from '../core/options';
import {
	Alert,
	DAY,
	NAMED_KEYS,
	Thing,
	checkKeysForEvent,
	click,
	currentSubreddit,
	isCurrentSubreddit,
	escapeHTML,
	empty,
	isPageType,
	loggedInUser,
	niceKeyCode,
	range,
	regexes,
	string,
	closestHtml,
} from '../utils';
import type { KeyArray } from '../utils/keycode';
import { ajax, i18n } from '../environment';
import type { RedditSearchSubredditNames, RedditSearchWikiNames } from '../types/reddit';
import * as SettingsNavigation from './settingsNavigation';

export const module: Module<{ [string]: any }> = new Module('commentTools');

module.moduleName = 'commentToolsName';
module.category = 'commentsCategory';
module.description = 'commentToolsDesc';
module.options = {
	userAutocomplete: {
		type: 'boolean',
		value: true,
		description: 'commentToolsUserAutoCompleteDesc',
		title: 'commentToolsUserAutoCompleteTitle',
		keywords: ['autosuggest'],
		advanced: true,
	},
	subredditAutocomplete: {
		type: 'boolean',
		value: true,
		description: 'commentToolsSubredditAutocompleteDesc',
		title: 'commentToolsSubredditAutocompleteTitle',
		keywords: ['autosuggest'],
		advanced: true,
	},
	wikiAutocomplete: {
		type: 'boolean',
		value: true,
		description: 'commentToolsWikiAutocompleteDesc',
		title: 'commentToolsWikiAutocompleteTitle',
		advanced: true,
	},
	formattingToolButtons: {
		type: 'boolean',
		value: true,
		description: 'commentToolsFormattingToolButtonsDesc',
		title: 'commentToolsFormattingToolButtonsTitle',
	},
	keyboardShortcuts: {
		dependsOn: options => options.formattingToolButtons.value,
		type: 'boolean',
		value: true,
		description: 'commentToolsKeyboardShortcutsDesc',
		title: 'commentToolsKeyboardShortcutsTitle',
	},
	boldKey: {
		dependsOn: options => options.keyboardShortcuts.value,
		type: 'keycode',
		value: [66, false, true, false, false], // ctrl-b
		description: 'commentToolsBoldKeyDesc',
		title: 'commentToolsBoldKeyTitle',
	},
	italicKey: {
		dependsOn: options => options.keyboardShortcuts.value,
		type: 'keycode',
		value: [73, false, true, false, false], // ctrl-i
		description: 'commentToolsItalicKeyDesc',
		title: 'commentToolsItalicKeyTitle',
	},
	strikeKey: {
		dependsOn: options => options.keyboardShortcuts.value,
		type: 'keycode',
		value: [83, false, true, false, false], // ctrl-s
		description: 'commentToolsStrikeKeyDesc',
		title: 'commentToolsStrikeKeyTitle',
	},
	superKey: {
		dependsOn: options => options.keyboardShortcuts.value,
		type: 'keycode',
		value: [187, false, true, true, false], // ctrl-+ (ctrl-shift-=)
		description: 'commentToolsSuperKeyDesc',
		title: 'commentToolsSuperKeyTitle',
	},
	linkKey: {
		dependsOn: options => options.keyboardShortcuts.value,
		type: 'keycode',
		value: [75, false, true, false, false], // ctrl-k
		description: 'commentToolsLinkKeyDesc',
		title: 'commentToolsLinkKeyTitle',
	},
	quoteKey: {
		dependsOn: options => options.keyboardShortcuts.value,
		type: 'keycode',
		value: [190, false, true, true, false], // ctrl-> (strl-shift-.)
		description: 'commentToolsQuoteKeyDesc',
		title: 'commentToolsQuoteKeyTitle',
	},
	ctrlEnterSubmitsComments: {
		type: 'boolean',
		value: true,
		description: 'commentToolsCtrlEnterSubmitsCommentsDesc',
		title: 'commentToolsCtrlEnterSubmitsCommentsTitle',
	},
	ctrlEnterSavesLiveThreads: {
		type: 'boolean',
		value: true,
		description: 'commentToolsCtrlEnterSavesLiveThreadsDesc',
		title: 'commentToolsCtrlEnterSavesLiveThreadsTitle',
	},
	ctrlEnterSubmitsPosts: {
		type: 'boolean',
		value: true,
		description: 'commentToolsCtrolEnterSubmitsPostsDesc',
		title: 'commentToolsCtrolEnterSubmitsPostsTitle',
	},
	commentingAs: {
		type: 'boolean',
		value: true,
		description: 'commentToolsCommentingAsDesc',
		title: 'commentToolsCommentingAsTitle',
	},
	highlightIfAltAccount: {
		dependsOn: options => options.commentingAs.value,
		type: 'boolean',
		value: true,
		description: 'commentToolsHighlightIfAltAccountDesc',
		title: 'commentToolsHighlightIfAltAccountTitle',
	},
	showInputLength: {
		type: 'boolean',
		value: true,
		description: 'commentToolsShowInputLengthDesc',
		title: 'commentToolsShowInputLengthTitle',
		advanced: true,
		bodyClass: true,
	},
	macroButtons: {
		type: 'boolean',
		value: true,
		description: 'commentToolsMacroButtonsDesc',
		title: 'commentToolsMacroButtonsTitle',
		bodyClass: true,
	},
	macros: {
		dependsOn: options => options.macroButtons.value,
		type: 'table',
		addRowText: 'commentToolsAddShortcut',
		fields: [{
			key: 'label',
			name: 'commentToolsLabel',
			type: 'text',
		}, {
			key: 'text',
			name: 'commentToolsText',
			type: 'textarea',
		}, {
			key: 'category',
			name: 'commentToolsCategory',
			type: 'text',
		}, {
			key: 'key',
			name: 'commentToolsKey',
			type: 'keycode',
		}],
		value: ([
			['reddiquette', '[reddiquette](https://support.reddithelp.com/hc/articles/205926439-Reddiquette) ', undefined, undefined],
			['Current timestamp', '{{now}} ', undefined, undefined],
		]: Array<[string, string, string | void, KeyArray | void]>),
		description: 'commentToolsMacrosDesc',
		title: 'commentToolsMacrosTitle',
	},
	keepMacroListOpen: {
		dependsOn: options => options.macroButtons.value,
		type: 'boolean',
		value: false,
		description: 'commentToolsKeepMacroListOpenDesc',
		title: 'commentToolsKeepMacroListOpenTitle',
		advanced: true,
	},
	macroPlaceholders: {
		dependsOn: options => options.macroButtons.value,
		type: 'boolean',
		value: true,
		description: 'commentToolsMacroPlaceholdersDesc',
		title: 'commentToolsMacroPlaceholdersTitle',
	},
	enabledOnBanMessages: {
		type: 'boolean',
		value: true,
		description: 'commentToolsEnableOnBanMessagesDesc',
		title: 'commentToolsEnableOnBanMessagesTitle',
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
	'liveThread',
	/^\/r\/[\-\w\.]+\/wiki\/(?:create|edit)(\/\w+)?/i,
];

const SUBMIT_LIMITS = {
	STYLESHEET: 128 * 1024,
	SIDEBAR: 10240,
	DESCRIPTION: 500,
	WIKI: 512 * 1024,
	COMMENT: 10000,
	LIVE_COMMENT: 4096,
	POST: 40000,
	POST_TITLE: 300,
	BAN_MESSAGE: 1000,
};
const macroCallbackTable: Array<(box: HTMLTextAreaElement) => void> = [];
const macroKeyTable: Array<[KeyArray, number]> = [];

module.contentStart = () => {
	document.body.addEventListener('focus', (e: Event) => {
		if (e.target instanceof HTMLTextAreaElement && e.target.matches(commentTextareaSelector)) {
			attachEditorToUsertext.call(e.target);
		}
	}, true);

	initializeCtrlEnterToSubmit();
	initializeLengthCounters();
	initializeAutocomplete();
};

function initializeCtrlEnterToSubmit() {
	if (module.options.ctrlEnterSubmitsComments.value) {
		onCtrlEnter(
			'.usertext-edit textarea, #BigEditor textarea, #wiki_page_content',
			e => {
				const currentForm = e.currentTarget.closest('form');
				if (!currentForm) return;
				const saveButton = currentForm.querySelector('.save') || currentForm.querySelector('#wiki_save_button') || document.querySelector('.BEFoot button');
				if (saveButton) click(saveButton);
			},
		);
	}

	if (module.options.ctrlEnterSavesLiveThreads.value) {
		onCtrlEnter(
			'.usertext-edit textarea',
			() => {
				const saveButton = document.querySelector('#new-update-form .save-button button');
				if (saveButton) click(saveButton);
			},
		);
	}

	if (module.options.ctrlEnterSubmitsPosts.value) {
		onCtrlEnter(
			'#title-field textarea, #text-field textarea, #url, #sr-autocomplete, input.captcha',
			() => {
				const captcha = document.querySelector('input.captcha:not(.cap-text)');
				if (captcha && (captcha: any).value === '') {
					captcha.focus();
				} else {
					const btn = document.querySelector('.spacer .btn');
					if (btn) click(btn);
				}
			},
		);
	}
}

function initializeLengthCounters() {
	if (module.options.showInputLength.value) {
		document.body.addEventListener('input', (e: Event) => {
			if (e.target instanceof HTMLElement && e.target.matches('.usertext-edit textarea, #title-field textarea, #BigEditor textarea, #wiki_page_content, #ban_message')) {
				updateCounter(e.target);
			}
		});

		// add title counter
		const titleSpan = document.querySelector('.submit-page #title-field span.title');
		if (titleSpan) {
			const counter = document.createElement('span');
			counter.className = 'RESCharCounter';
			counter.title = 'character limit: 0/300';
			counter.textContent = '0/300';
			titleSpan.prepend(counter);
		}
	}
}

const initializeEditorTools = once(() => {
	document.body.addEventListener('click', (e: Event) => {
		const editLink = e.target instanceof Element && e.target.closest('div.markdownEditor-wrapper a:not(.userTagLink)');
		if (editLink) {
			e.preventDefault();

			const index = parseInt(editLink.getAttribute('data-macro-index'), 10);
			const box = findTextareaForElement(editLink);
			if (!box) {
				console.error('Failed to locate textarea.');
				return;
			}
			const handler = macroCallbackTable[index];
			if (!handler) {
				throw new Error(`No macro callback at index: ${index}.`);
			}
			handler(box);

			box.focus();
			// Fire an input event to refresh the preview
			box.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
		}

		const macroTitle = closestHtml(e.target, '.RESMacroDropdownTitle');
		if (macroTitle) {
			if (macroTitle.classList.contains('openMacro')) {
				macroTitle.classList.remove('openMacro');
			} else {
				for (const s of document.querySelectorAll('.RESMacroWrappingSpan span')) s.classList.remove('openMacro');
				macroTitle.classList.add('openMacro');
			}
			// position the drop down so it's flush with the right of the category button.
			const nextSib = (macroTitle.nextSibling: any);
			if (nextSib && nextSib.style) {
				nextSib.style.top = `${macroTitle.offsetTop + macroTitle.offsetHeight}px`;
				nextSib.style.left = `${macroTitle.offsetLeft + macroTitle.offsetWidth - nextSib.offsetWidth}px`;
			}
		}
	});

	if (module.options.keyboardShortcuts.value) {
		document.body.addEventListener('keydown', (e: KeyboardEvent) => {
			if (!(e.target instanceof HTMLElement) || !e.target.matches('.usertext-edit textarea, #BigEditor textarea, #wiki_page_content, #ban_message')) return;
			const textarea = e.target;

			if (e.key === NAMED_KEYS.Escape) {
				textarea.blur();
				e.preventDefault();
				return;
			}

			for (const [testedKeyArray, macroIndex] of macroKeyTable) {
				if (checkKeysForEvent(e, testedKeyArray)) {
					const handler = macroCallbackTable[macroIndex];
					handler((textarea: any));

					// Fire an input event to refresh the preview
					textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

					e.preventDefault();
					return;
				}
			}
		});
	}
});

// `join(':not([readonly]),')` put the guard *between* entries, so the last one —
// `textarea[name=title]` — had none, and RES attached its edit bar, character
// counter and Ctrl+Enter handler to readonly title fields. Map the suffix onto
// every entry and join with a plain comma, so adding a name to the list cannot
// silently move the unguarded slot to a different selector.
export const commentTextareaSelector = [
	'textarea[name=text]',
	'textarea[name=description]',
	'textarea[name=public_description]',
	'textarea[name=body]',
	'textarea[name=ban_message]',
	'textarea[name=content]',
	'textarea[name=title]',
].map(selector => `${selector}:not([readonly])`).join(',');

function getFieldLimit(elem) {
	switch (elem.name) {
		case 'title':
			return SUBMIT_LIMITS.POST_TITLE;
		case 'text': // https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/829
			if (isPageType('submit') || (elem.closest('.thing') && elem.closest('.thing').classList.contains('self'))) {
				return SUBMIT_LIMITS.POST;
			}
			return SUBMIT_LIMITS.COMMENT;
		case 'description':
			return SUBMIT_LIMITS.SIDEBAR;
		case 'body':
			return SUBMIT_LIMITS.LIVE_COMMENT;
		case 'public_description':
			return SUBMIT_LIMITS.DESCRIPTION;
		case 'content':
			return SUBMIT_LIMITS.WIKI;
		case 'ban_message':
			return SUBMIT_LIMITS.BAN_MESSAGE;
		// case 'description_conflict_old':
		// case 'public_description_conflict_old':
		default:
			return 1337; // should be easier to debug than 0
	}
}

function attachEditorToUsertext() {
	if (this.hasAttribute('commentTools-initialized')) return;
	this.setAttribute('commentTools-initialized', true);

	if (this.hasAttribute('data-max-length')) {
		return;
	}
	const limit = getFieldLimit(this);

	this.setAttribute('data-limit', limit);

	if (this.name === 'title') {
		return;
	}

	if (this.id === 'ban_message' && !module.options.enabledOnBanMessages.value) {
		return;
	}

	if (this.id === 'ban_message') {
		this.style.width = '500px';
		this.style.height = '100px';
	}

	const bar = makeEditBar();
	if (this.id === 'wiki_page_content' || this.id === 'ban_message') {
		this.parentElement.prepend(bar);
	} else {
		this.parentElement.before(bar);
	}
	updateCounter(this);
}

export function updateCounter(textarea: HTMLElement) {
	const length = (textarea: any).value.length;
	const limit = textarea.getAttribute('data-limit');
	const parent = textarea.parentElement && textarea.parentElement.parentElement;
	const counter = parent && parent.querySelector('.RESCharCounter');
	if (!counter) return;
	counter.title = `character limit: ${length}/${limit}`;
	counter.textContent = `${length}/${limit}`;
	if (length > limit) {
		counter.classList.add('tooLong');
	} else {
		counter.classList.remove('tooLong');
	}
}

let cachedEditBar;

export function makeEditBar() {
	initializeEditorTools();

	if (cachedEditBar) {
		return cachedEditBar.cloneNode(true);
	}

	const editBar = document.createElement('div');
	editBar.className = 'markdownEditor';
	// Wrap the edit bar in a <div> of its own
	const wrappedEditBar = document.createElement('div');
	wrappedEditBar.className = 'markdownEditor-wrapper';
	wrappedEditBar.appendChild(editBar);

	if (module.options.commentingAs.value) {
		// show who we're commenting as...
		const commentingAsMessage = location.href.match(/^https?:\/\/(?:[\-\w\.]+\.)?reddit\.com\/r\/[\-\w\.]+\/about\/banned\/?/i) ? 'Moderating as' : 'Speaking as';

		const commentingAs = document.createElement('div');
		commentingAs.className = 'commentingAs';
		commentingAs.textContent = `${commentingAsMessage}: `;
		const userLink = document.querySelector('#header-bottom-right .user a:first-child');
		if (userLink) {
			const wrapper = document.createElement('span');
			wrapper.className = 'commentingAsUser';
			wrapper.appendChild(userLink.cloneNode(true));
			commentingAs.appendChild(wrapper);
		}
		wrappedEditBar.appendChild(commentingAs);
	}

	if (module.options.formattingToolButtons.value) {
		const shortcuts = module.options.keyboardShortcuts.value;
		editBar.append(makeEditButton('<b>Bold</b>', `bold${shortcuts ? ` (${niceKeyCode(module.options.boldKey.value)})` : ''}`, module.options.boldKey.value, 'btn-bold', box => {
			wrapSelection(box, '**', '**');
		}));
		editBar.append(makeEditButton('<i>Italic</i>', `italic${shortcuts ? ` (${niceKeyCode(module.options.italicKey.value)})` : ''}`, module.options.italicKey.value, 'btn-italic', box => {
			wrapSelection(box, '*', '*');
		}));
		editBar.append(makeEditButton('<del>strike</del>', `strike${shortcuts ? ` (${niceKeyCode(module.options.strikeKey.value)})` : ''}`, module.options.strikeKey.value, 'btn-strike', box => {
			wrapSelection(box, '~~', '~~');
		}));
		editBar.append(makeEditButton('<sup>sup</sup>', `super${shortcuts ? ` (${niceKeyCode(module.options.superKey.value)})` : ''}`, module.options.superKey.value, 'btn-superscript', box => {
			wrapSelectedWords(box, '^');
		}));
		editBar.append(makeEditButton('Link', `link${shortcuts ? ` (${niceKeyCode(module.options.linkKey.value)})` : ''}`, module.options.linkKey.value, 'btn-link', box => {
			linkSelection(box);
		}));
		editBar.append(makeEditButton('>Quote', `quote${shortcuts ? ` (${niceKeyCode(module.options.quoteKey.value)})` : ''}`, module.options.quoteKey.value, 'btn-quote', box => {
			wrapSelectedLines(box, '> ', '');
		}));
		editBar.append(makeEditButton('<span style="font-family: monospace">Code</span>', 'code', null, 'btn-code', box => {
			wrapSelectedLines(box, '    ', '');
		}));
		editBar.append(makeEditButton('&bull;Bullets', 'bullet list', null, 'btn-list-unordered', box => {
			wrapSelectedLines(box, '* ', '');
		}));
		editBar.append(makeEditButton('1.Numbers', 'number list', null, 'btn-list-ordered', box => {
			wrapSelectedLines(box, '1. ', '');
		}));
		editBar.append(makeEditButton('<span style="border: 1px black solid;">Table</span>', 'table', null, 'btn-table', box => {
			// First check if the selected text is a table, this also clean the selection
			const selectedText = box.value.substring(box.selectionStart, box.selectionEnd).replace(/^[\s]+/, '').replace(/[\s]+$/, '').split('\n');
			let isTable;
			if (selectedText.length >= 2) {
				if (selectedText[0].includes('|')) {
					selectedText[0] = selectedText[0].replace(/^\|/, '').replace(/\|\s+$/, '');
					const numSeparator = selectedText[0].split('|').length;
					isTable = true;

					selectedText[1] = selectedText[1].replace(/\|[^|\-]+$/, '');
					selectedText[1] = selectedText[1].replace(/-/g, '--');
					if (!selectedText[1].includes('-|') && !selectedText[1].includes('|-')) {
						isTable = false;
					}
					selectedText[1] = selectedText[1].replace(/^\]+/, '').replace(/[\s|]+$/, '');
					if (selectedText[1].split('-|-').length < numSeparator) {
						isTable = false;
					}
					if ((/[^|\-]/).test(selectedText[1])) {
						isTable = false;
					}

					if (isTable) {
						for (const i of range(2, selectedText.length)) {
							if (!selectedText[i].includes('|')) {
								isTable = false;
								break;
							}
							selectedText[i] = selectedText[i].replace(/^\|/, '').replace(/[\s|]+$/, '');
							if (selectedText[i].split('|').length !== numSeparator)	{
								isTable = false;
								break;
							}
						}
					}
				}
			}
			let startTable;
			if (isTable) {
				startTable = selectedText.reduce((prevTable, currText, i) => {
					if (i === 1) {
						return prevTable;
					}

					return `${prevTable}<tr><td>${escapeHTML(currText).replace(/\|/g, '</td><td>')}</td></tr>`;
				}, '');
			} else {
				startTable = '<tr><td>Foo</td><td>Bar</td></tr><tr><td>Foo</td><td>Bar</td></tr>';
			}
			const element = string.html`<div><div class="buttonContainer"></div><table class="commentPreview" contenteditable="true">${string.safe(startTable)}</table></div>`;
			Alert.open(element, { cancelable: true })
				.then(() => {
					const firstRow = element.querySelector('tr:first-child');
					let generatedTable = '\n\n';
					let generatedTableSeparation = '';
					if (firstRow) {
						for (const td of firstRow.querySelectorAll('td')) {
							const text = td.textContent.replace(/[\n|]/g, '');
							generatedTable += `${text} | `;
							generatedTableSeparation += '-'.repeat(text.length);
							generatedTableSeparation += '|';
						}
					}
					generatedTableSeparation = generatedTableSeparation.substr(0, generatedTableSeparation.length - 1);
					generatedTable = `${generatedTable.substr(0, generatedTable.length - 3)}\n${generatedTableSeparation}\n`;
					const rows = element.querySelectorAll('tr');
					for (let i = 1; i < rows.length; i++) {
						for (const td of rows[i].querySelectorAll('td')) {
							generatedTable += `${td.textContent.replace(/[\n|]/g, '')} | `;
						}
						generatedTable = `${generatedTable.substr(0, generatedTable.length - 3)}\n`;
					}
					if (isTable) {
						replaceSelection(box, generatedTable);
					} else {
						wrapSelection(box, generatedTable, '');
					}
					box.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
				});

			const addRow = Alert.makeButton('+ Row');
			const remRow = Alert.makeButton('- Row');
			const addCol = Alert.makeButton('+ Col');
			const remCol = Alert.makeButton('- Col');
			addRow.addEventListener('click', () => {
				const firstRow = element.querySelector('tr:first-child');
				const nbCol = firstRow ? firstRow.querySelectorAll('td').length : 0;
				const newRow = '<td>text</td>'.repeat(nbCol);
				const table = element.querySelector('table');
				if (table) table.insertAdjacentHTML('beforeend', `<tr>${newRow}</tr>`);
			});
			remRow.addEventListener('click', () => {
				const rows = element.querySelectorAll('tr');
				if (rows.length > 1) {
					rows[rows.length - 1].remove();
				}
			});
			addCol.addEventListener('click', () => {
				for (const tr of element.querySelectorAll('table tr')) {
					tr.insertAdjacentHTML('beforeend', '<td>text</td>');
				}
			});
			remCol.addEventListener('click', () => {
				const firstRow = element.querySelector('tr:first-child');
				if (firstRow && firstRow.querySelectorAll('td').length > 1) {
					for (const td of element.querySelectorAll('table tr td:last-of-type')) {
						td.remove();
					}
				}
			});

			const buttonContainer = element.querySelector('.buttonContainer');
			buttonContainer.append(addRow, remRow, addCol, remCol);
		}));
	}

	if (module.options.showInputLength.value) {
		const counter = document.createElement('span');
		counter.className = 'RESCharCounter';
		counter.title = 'character limit: 0/?????';
		counter.textContent = '0/?????';
		editBar.prepend(counter); // prepend for more reliable css floating.
	}

	if (module.options.macroButtons.value) {
		buildMacroDropdowns(wrappedEditBar);

		const addMacroButton = makeEditButton(i18n(module.options.macros.addRowText), null, null, 'btn-macro btn-macro-add', () => {
			SettingsNavigation.open(module.moduleID, 'macros');
			for (const s of document.querySelectorAll('.RESMacroWrappingSpan span')) s.classList.remove('openMacro');
		});
		addButtonToMacroGroup('', addMacroButton);
	}

	cachedEditBar = wrappedEditBar;
	return cachedEditBar;
}

const macroDropDownTable = new Map();

function getMacroGroup(groupName) {
	// Normalize and supply a default group name{}
	groupName = (groupName || '').toString().trim() || 'macros';
	let macroGroup = macroDropDownTable.get(groupName);
	if (macroGroup === undefined) {
		macroGroup = {};
		const titleButton = document.createElement('span');
		titleButton.className = 'RESMacroDropdownTitle';
		titleButton.textContent = groupName;
		macroGroup.titleButton = titleButton;
		const container = document.createElement('span');
		container.className = 'RESMacroDropdown';
		macroGroup.container = container;
		const dropdown = document.createElement('ul');
		dropdown.className = 'RESMacroDropdownList';
		macroGroup.dropdown = dropdown;
		container.appendChild(dropdown);
		macroDropDownTable.set(groupName, macroGroup);
	}
	return macroGroup;
}

function addButtonToMacroGroup(groupName, button) {
	const group = getMacroGroup(groupName);
	const li = document.createElement('li');
	li.appendChild(button);
	group.dropdown.appendChild(li);
}

function getDebugMacros() {
	if (!isCurrentSubreddit('Enhancement', 'RESissues')) return [];
	return [
		['RES modified settings', '\n\n{{resmodifiedsettings}}\n', null, null],
		['RES diagnostics', '{{resdiagnostics}}', null, null],
	];
}

function buildMacroDropdowns(editBar) {
	const macros = [...module.options.macros.value, ...getDebugMacros()];

	for (const [title, text, category, key] of macros) {
		const button = makeEditButton(title, null, key, 'btn-macro', box => {
			macroSelection(box, text);
		});
		addButtonToMacroGroup(category, button);
	}

	const macroWrapper = document.createElement('span');
	macroWrapper.className = 'RESMacroWrappingSpan';

	const defaultGroup = getMacroGroup('');
	macroWrapper.append(defaultGroup.titleButton, defaultGroup.container);

	for (const [category, macroGroup] of macroDropDownTable) {
		if (category === 'macros') {
			continue;
		}
		macroWrapper.append(macroGroup.titleButton, macroGroup.container);
	}
	editBar.appendChild(macroWrapper);
}

function makeEditButton(label, title, key, cls, handler) {
	if (label === null) {
		label = 'unlabeled';
	}
	if (title === null) {
		title = '';
	}
	const macroButtonIndex = macroCallbackTable.length;
	const button = string.html`<a class="edit-btn ${cls}" title="${title}" href="#" tabindex="1" data-macro-index="${macroButtonIndex}">${label}</a>`;

	if (key && key[0] !== null) {
		macroKeyTable.push([key, macroButtonIndex]);
	}
	macroCallbackTable[macroButtonIndex] = handler;
	return button;
}

function linkSelection(box) {
	let url = prompt('Enter the URL:', '');
	if (url) {
		// escape parens in url
		url = url.replace(/[\(\)]/g, '\\$&');
		// escape brackets and parens in text
		wrapSelection(box, '[', `](${url})`, text => text.replace(/[\[\]\(\)]/g, '\\$&'));
	}
}

function macroSelection(box, macroText) {
	if (!module.options.keepMacroListOpen.value) {
		for (const s of document.querySelectorAll('.RESMacroWrappingSpan span')) s.classList.remove('openMacro');
	}
	if (module.options.macroPlaceholders.value) {
		const formatText = selectedText => fillPlaceholders(box, macroText, selectedText);
		wrapSelection(box, '', '', formatText);
	} else {
		wrapSelection(box, macroText, '');
	}
}

function fillPlaceholders(box, macroText, selectedText) {
	const placeholders = macroText.match(/\{\{\w+\}\}/g);
	if (placeholders) {
		const completedPlaceholders = new Set();
		for (const placeholder of placeholders) {
			if (completedPlaceholders.has(placeholder)) {
				continue;
			}
			completedPlaceholders.add(placeholder);

			const placeholderInnerText = placeholder.substring(2, placeholder.length - 2).toLowerCase();
			let value;
			try {
				value = getMagicPlaceholderValue(placeholderInnerText, macroText, selectedText, box);
			} catch (e) {
				console.error('Error getting magic placeholder value', placeholderInnerText);
				console.error(e);
			}
			if (value === undefined) {
				value = promptForPlaceholderValue(placeholder, macroText);
			}

			if (value === null) {
				// user cancelled
				break;
			}

			// Replace placeholder with value
			macroText = macroText.replace(new RegExp(placeholder, 'g'), value);
		}
	}

	return macroText;
}

function getMagicPlaceholderValue(placeholder, macroText, selectedText, box) {
	const handler = magicPlaceholders.find(current => current.matches.includes(placeholder));

	if (handler) {
		return handler.handle(macroText, selectedText, box);
	}
}

const magicPlaceholders: Array<{|
	matches: string[],
	handle: (macroText: string, selectedText: string, box: HTMLTextAreaElement) => void | string,
|}> = [
	{
		matches: ['subreddit'],
		handle(macroText, selectedText, box) {
			const thing = Thing.from(box);
			const subreddit = thing && thing.getSubreddit();

			if (subreddit) {
				return `/r/${subreddit}`;
			}
		},
	}, {
		matches: ['me', 'my_username'],
		handle() {
			const username = loggedInUser();
			if (username) {
				return `/u/${username}`;
			}
		},
	}, {
		matches: ['op', 'op_username'],
		handle(macroText, selectedText, box) {
			let profile: ?HTMLAnchorElement;
			if (isPageType('comments')) {
				profile = (document.querySelector('.sitetable .author'): any);
			} else {
				let current = box.closest('.sitetable');
				let furthest = current || box;
				while (current) {
					furthest = current;
					const parent = current.parentElement;
					current = parent && parent.closest('.sitetable');
				}

				profile = (furthest.querySelector('.author'): any);
			}

			if (profile) {
				const match = profile.pathname.match(regexes.profile);
				if (!match) throw new Error(`Invalid profile link: ${profile.href}`);
				return `/u/${match[1]}`;
			}
		},
	}, {
		matches: ['url'],
		handle() {
			return location.href;
		},
	}, {
		matches: ['reply_to', 'reply_to_username'],
		handle(macroText, selectedText, box) {
			const entry = box.closest('.thing, .entry');
			const isEditing = entry && entry.classList.contains('entry');

			let base = box;
			if (isEditing) {
				const thing = box.closest('.thing');
				base = thing ? thing.parentElement : box;
			}

			const closestThing = base.closest('.thing');
			const profile: ?HTMLAnchorElement = closestThing ? (closestThing.querySelector('.entry .author'): any) : null;

			if (!profile) {
				return getMagicPlaceholderValue('op', macroText, selectedText, box);
			} else {
				const match = profile.pathname.match(regexes.profile);
				if (!match) throw new Error(`Invalid profile link: ${String(profile)}`);
				return `/u/${match[1]}`;
			}
		},
	}, {
		matches: ['selected', 'selection'],
		handle(macroText, selectedText) {
			return selectedText;
		},
	}, {
		matches: ['now'],
		handle() {
			const date = new Date();
			return date.toTimeString();
		},
	}, {
		matches: ['today'],
		handle() {
			const date = new Date();
			return date.toDateString();
		},
	}, {
		matches: ['linkflair'],
		handle() {
			if (isPageType('comments')) {
				return document.querySelector('.linkflairlabel').textContent;
			}
		},
	}, {
		matches: ['escaped'],
		handle(macroText, selectedText) {
			return selectedText
				.replace(/[\[\]()\\\*\^~\-_.]/g, '\\$&')
				// more than 3 spaces before a >quote starts a code block
				.replace(/^([ ]{0,3})>/gm, '$1\\>');
		},
	}, {
		matches: ['resmodifiedsettings'],
		handle() { return Options.getModifiedText(); },
	},
];

function promptForPlaceholderValue(placeholder, macroText) {
	// Get value for placeholder
	const display = `${macroText}\n\n\nEnter replacement for ${placeholder}:`;
	const value = placeholder;

	return prompt(display, value);
}

function wrapSelection(box, prefix, suffix, escapeFunction) {
	if (!box) {
		return;
	}
	// record scroll top to restore it later.
	const scrollTop = box.scrollTop;

	// We will restore the selection later, so record the current selection.
	const selectionStart = box.selectionStart;
	const selectionEnd = box.selectionEnd;

	const text = box.value;
	const beforeSelection = text.substring(0, selectionStart);
	let selectedText = text.substring(selectionStart, selectionEnd);
	const afterSelection = text.substring(selectionEnd);

	let trailingSpace = '';
	let cursor = selectedText.length - 1;
	while (cursor > 0 && selectedText[cursor] === ' ') {
		trailingSpace += ' ';
		cursor--;
	}
	selectedText = selectedText.substring(0, cursor + 1);

	if (typeof escapeFunction === 'function') {
		selectedText = escapeFunction(selectedText);
	}

	box.value = beforeSelection + prefix + selectedText + suffix + trailingSpace + afterSelection;

	box.selectionEnd = beforeSelection.length + prefix.length + selectedText.length;
	if (selectionStart === selectionEnd) {
		box.selectionStart = box.selectionEnd;
	} else {
		box.selectionStart = beforeSelection.length + prefix.length;
	}

	box.scrollTop = scrollTop;
}

function replaceSelection(box, replacement) {
	if (!box) {
		return;
	}
	const scrollTop = box.scrollTop;
	const selectionStart = box.selectionStart;
	const selectionEnd = box.selectionEnd;
	const text = box.value;
	const beforeSelection = text.substring(0, selectionStart);
	const afterSelection = text.substring(selectionEnd);

	box.value = beforeSelection + replacement + afterSelection;
	box.selectionEnd = beforeSelection.length + replacement.length;
	box.scrollTop = scrollTop;
}

function wrapSelectedLines(box, prefix, suffix) {
	const scrollTop = box.scrollTop;
	let selectionStart = box.selectionStart;
	let selectionEnd = box.selectionEnd;

	const text = box.value;
	let startPosition = 0;
	const lines = text.split('\n');
	for (const i of range(0, lines.length)) {
		let lineStart = startPosition;
		let lineEnd = lineStart + lines[i].length;
		if (selectionStart <= lineStart && lineStart <= selectionEnd || selectionStart <= lineEnd && lineEnd <= selectionEnd ||
				lineStart <= selectionStart && selectionStart <= lineEnd || lineStart <= selectionEnd && selectionEnd <= lineEnd) {
			lines[i] = prefix + lines[i] + suffix;
			let startMovement = 0;
			let endMovement = 0;
			if (lineStart < selectionStart) {
				startMovement += prefix.length;
			}
			if (lineEnd < selectionStart) {
				startMovement += suffix.length;
			}
			if (lineStart < selectionEnd) {
				endMovement += prefix.length;
			}
			if (lineEnd < selectionEnd) {
				endMovement += suffix.length;
			}

			selectionStart += startMovement;
			selectionEnd += endMovement;
			lineStart += prefix.length;
			lineEnd += prefix.length + suffix.length;
		}
		startPosition = lineEnd + 1;
	}

	box.value = lines.join('\n');
	box.selectionStart = selectionStart;
	box.selectionEnd = selectionEnd;
	box.scrollTop = scrollTop;
}

function wrapSelectedWords(box, prefix) {
	const scrollTop = box.scrollTop;
	let selectionStart = box.selectionStart;
	const selectionEnd = box.selectionEnd;

	const text = box.value;
	const beforeSelection = text.substring(0, selectionStart);
	const selectedWords = text.substring(selectionStart, selectionEnd).split(' ');
	const afterSelection = text.substring(selectionEnd);

	let selectionModify = 0;

	for (const i of range(0, selectedWords.length)) {
		if (selectedWords[i] !== '') {
			if (selectedWords[i].includes('\n')) {
				const newLinePosition = selectedWords[i].lastIndexOf('\n') + 1;
				selectedWords[i] = selectedWords[i].substring(0, newLinePosition) + prefix + selectedWords[i].substring(newLinePosition);
				selectionModify += prefix.length;
			}
			if (selectedWords[i].charAt(0) !== '\n') {
				selectedWords[i] = prefix + selectedWords[i];
			}
			selectionModify += prefix.length;
		} else if (selectedWords[i] === '' && selectedWords.length === 1) {
			selectedWords[i] = prefix + selectedWords[i];
			selectionModify += prefix.length;
			selectionStart += prefix.length;
		}
	}

	box.value = beforeSelection + selectedWords.join(' ') + afterSelection;
	box.selectionStart = selectionStart;
	box.selectionEnd = selectionEnd + selectionModify;
	box.scrollTop = scrollTop;
}

const autoCompleteMatchRegExp = /(^|\W)\/?(?:r\/([\w]+)\/)?(wiki|w|r|u)\/([-\w]+)$/;

function initializeAutocomplete() {
	if (
		!module.options.subredditAutocomplete.value &&
		!module.options.userAutocomplete.value &&
		!module.options.wikiAutocomplete.value
	) return;

	document.body.addEventListener('input', debounce(async (e: Event) => {
		if (!(e.target instanceof HTMLTextAreaElement)) return;
		if (!e.target.matches('.usertext .usertext-edit textarea, #BigText, #wiki_page_content')) return;
		const textarea: HTMLTextAreaElement = e.target;
		const prefixText = textarea.value.slice(0, textarea.selectionStart);
		const [,, subreddit, [type] = [], query] = autoCompleteMatchRegExp.exec(prefixText) || [];
		const completions = query && (
			type === 'u' && module.options.userAutocomplete.value && await getUserCompletions(query) ||
				type === 'r' && module.options.subredditAutocomplete.value && await getSubredditCompletions(query) ||
				type === 'w' && module.options.wikiAutocomplete.value && await getWikiCompletions(query, subreddit || currentSubreddit() || '')
		) || [];
		autoComplete(textarea)(completions);
	}, 100));
}

const autoComplete = memoize(textarea => {
	const element = string.html`<div id="autocomplete_dropdown" class="drop-choices srdrop"></div>`;
	let entries = [];
	let index = 0;

	element.addEventListener('click', (e: MouseEvent) => {
		const text = (e.target.closest('.choice') || e.target).textContent;
		const caretPos = textarea.selectionStart;
		let left = textarea.value.substr(0, caretPos);
		const right = textarea.value.substr(caretPos);
		left = left.replace(autoCompleteMatchRegExp, `$1${text} `);
		textarea.value = left + right;
		textarea.selectionStart = textarea.selectionEnd = left.length;
		textarea.focus();
		textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
	});

	const updateSelection = () => {
		for (const entry of entries) entry.classList.remove('selectedItem');
		entries[index % entries.length].classList.add('selectedItem');
	};

	const remove = () => {
		element.remove();
		textarea.removeEventListener('keydown', navigate);
		textarea.removeEventListener('blur', remove);
	};

	const navigate = (e: KeyboardEvent) => {
		if (e.metaKey || e.shiftKey || e.ctrlKey || e.altKey) return;
		if (!document.contains(element)) return;
		switch (e.key) {
			case NAMED_KEYS.Down:
			case NAMED_KEYS.Right:
				e.preventDefault();
				index++;
				updateSelection();
				return;
			case NAMED_KEYS.Up:
			case NAMED_KEYS.Left:
				e.preventDefault();
				index--;
				updateSelection();
				return;
			case NAMED_KEYS.Tab:
			case NAMED_KEYS.Enter:
				e.preventDefault();
				entries[index % entries.length].click();
				return;
			case NAMED_KEYS.Escape:
				e.preventDefault();
				e.stopImmediatePropagation();
				remove();
				break;
			default:
				break;
		}
	};

	// Function to update the auto-complete
	return matches => {
		if (!matches.length || document.activeElement !== textarea) {
			remove();
			return;
		}

		empty(element);
		entries = matches.slice(0, 20).map(text => string.html`<a class="choice">${text}</a>`);
		element.append(...entries);

		index = 0;
		updateSelection();

		if (!document.contains(element)) {
			const rect = textarea.getBoundingClientRect();
			element.style.left = `${rect.left + rect.width + window.scrollX}px`;
			element.style.top = `${rect.top + window.scrollY}px`;
			document.body.append(element);

			textarea.addEventListener('keydown', navigate);
			textarea.addEventListener('blur', () => {
				setTimeout(() => { if (document.activeElement !== textarea) remove(); }, 200);
			});
		}
	};
});

async function getSubredditCompletions(query) {
	const { names } = (await ajax({
		method: 'POST',
		url: '/api/search_reddit_names.json',
		query: { query }, // for the cache
		data: { query },
		type: 'json',
		cacheFor: DAY,
	}): RedditSearchSubredditNames);

	return names.map(name => `/r/${name}`);
}

function getUserCompletions(query: string) {
	if (!query) {
		return [];
	}

	// RES-Slim: user completion disabled (userTagger module removed).
	return [];
}

async function getWikiCompletions(query, subreddit: string) {
	const { data: wikiPages } = (await ajax({
		method: 'GET',
		url: `/r/${subreddit}/wiki/pages.json`,
		type: 'json',
		cacheFor: DAY,
	}): RedditSearchWikiNames);

	return wikiPages
		.filter(wikiPage => wikiPage.toLowerCase().startsWith(query.toLowerCase()))
		.map(wikiPage => `/r/${subreddit}/wiki/${wikiPage}`);
}

function findTextareaForElement(elem): HTMLTextAreaElement | void {
	const container = elem.closest('.usertext-edit, #BigEditor, .wiki-page-content, #banned');
	if (!container) return;
	const textarea = container.querySelector('textarea#BigText, textarea[name=text], textarea[name=description], textarea[name=public_description], textarea[name=body], textarea#wiki_page_content, textarea#ban_message');
	return (textarea: any);
}

export function onCtrlEnter(selector: string, callback: (e: KeyboardEvent) => Promise<void> | void) {
	document.body.addEventListener('keydown', (e: KeyboardEvent) => {
		if (!(e.target instanceof Element) || !e.target.matches(selector)) return;
		if (e.key === NAMED_KEYS.Enter && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			Object.defineProperty(e, 'currentTarget', { value: e.target });
			callback(e);
		}
	});
}
