/* @flow */

import { Sortable } from '../vendor';
import { i18n } from '../environment';
import { undo } from './createElement';
import { Alert, downcast, string } from './';

function createElement(tag, attrs = {}) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (key === 'class' || key === 'className') el.className = String(value);
		else if (key === 'html') el.innerHTML = String(value);
		else if (key === 'text') el.textContent = String(value);
		else el.setAttribute(key, String(value));
	}
	return el;
}

export function drawOptionBuilder(options: *, mod: *, optionName: *) {
	const option = options[optionName];
	const addRowButton = createElement('button', { class: 'addRowButton' });
	addRowButton.textContent = i18n(option.addItemText) || '+add item';
	const itemContainer = createElement('div', { class: 'optionBuilder' });

	itemContainer.setAttribute('data-module-id', mod.moduleID);
	itemContainer.setAttribute('data-option-name', optionName);

	addRowButton.addEventListener('click', function() {
		const newBody = drawBuilderItem(option.defaultTemplate(), option.customOptionsFields, option.cases);
		const builder = this.previousElementSibling;
		if (builder && builder.classList.contains('optionBuilder')) {
			builder.dispatchEvent(new Event('change', { bubbles: true }));
			builder.appendChild(newBody);
		}
		const firstText = newBody.querySelector('input[type=text], textarea');
		if (firstText) {
			setTimeout(() => firstText.focus(), 200);
		}
	});
	option.value.forEach(item => itemContainer.appendChild(drawBuilderItem(item, option.customOptionsFields, option.cases)));

	Sortable.create(itemContainer, { handle: '.handle' });

	const wrapper = document.createElement('div');
	wrapper.append(itemContainer, addRowButton);
	return wrapper;
}

function drawBuilderItem(data: *, customOptionsFields: * = [], cases: *) {
	const item = createElement('div', { class: 'builderItem' });

	const editButton = createElement('div', { class: 'res-icon-button res-icon builderControls builderTrailingControls', html: '&#xF061;', title: 'copy and share, or update your settings with a new version' });
	editButton.addEventListener('click', async () => {
		const data = readBuilderItem(item, customOptionsFields, cases);
		const element = string.html`<div>Copy this and share it, or update your settings with a new version: <br><br><textarea rows="5" cols="50"></textarea></div>`;
		const textarea = downcast(element.querySelector('textarea'), HTMLTextAreaElement);
		textarea.value = JSON.stringify(data);
		const newData = await Alert.open(element, { cancelable: true })
			.then(() => JSON.parse(textarea.value));
		const newItem = drawBuilderItem(newData, customOptionsFields, cases);
		item.replaceWith(newItem);
		newItem.dispatchEvent(new Event('change', { bubbles: true }));
	});

	const deleteButton = drawDeleteButton();
	deleteButton.classList.add('builderTrailingControls');
	deleteButton.addEventListener('click', () => {
		const parent = item.parentElement;
		item.dispatchEvent(new Event('change', { bubbles: true }));
		item.remove();
		undo('Restore deleted item').then(() => { if (parent) { parent.appendChild(item); parent.dispatchEvent(new Event('change', { bubbles: true })); } });
	});

	const customOptions = string.html`<ul class="builderCustomOptions"></ul>`;
	for (const fields of customOptionsFields) {
		const li = document.createElement('li');
		const drawn = drawFields(fields, data.opts || {});
		for (const d of Array.isArray(drawn) ? drawn : [drawn]) {
			if (d instanceof Node) li.appendChild(d);
			else if (typeof d === 'string') li.append(d);
		}
		customOptions.append(li);
	}

	const header = createElement('div', { class: 'builderItemControls' });
	const versionInput = createElement('input', { type: 'hidden', name: 'version' });
	(versionInput: any).value = data.ver;
	const idInput = createElement('input', { type: 'hidden', name: 'id' });
	(idInput: any).value = data.id;
	const noteTextarea = createElement('textarea', { name: 'builderNote', rows: '1', cols: '40', placeholder: 'Write a description/note for this' });
	(noteTextarea: any).value = data.note || '';
	const pushRight = createElement('div', { class: 'pushRight' });
	pushRight.append(editButton, deleteButton);

	header.append(
		drawHandle(),
		versionInput,
		idInput,
		customOptions,
		noteTextarea,
		pushRight,
	);

	const body = drawBuilderBlock(data.body, cases, false);

	if (body instanceof DocumentFragment) {
		item.append(header);
		item.append(body);
	} else if (body instanceof Node) {
		item.append(header, body);
	} else {
		item.append(header);
	}

	return item;
}

function drawHandle() {
	const handle = createElement('div', { class: 'res-icon-button res-icon handle builderControls', html: '&#xF0AA;', title: 'drag and drop to move this condition' });
	return handle;
}

function drawDeleteButton() {
	const btn = createElement('div', { class: 'res-icon-button res-icon builderControls', html: '&#xF056;', title: 'remove this condition' });
	return btn;
}

export function drawBuilderBlock(data: *, cases: *, addBaseControls: boolean = true) {
	if (!cases.hasOwnProperty(data.type)) {
		console.error(`Case type ${data.type} is not available. Ignoring block.`, data);
		return document.createDocumentFragment();
	}

	const block = createElement('div', { class: 'builderBlock' });
	block.setAttribute('data-type', data.type);
	const fields = drawFields(cases[data.type].fields, data, cases);
	for (const f of Array.isArray(fields) ? fields : [fields]) {
		if (f instanceof Node) block.appendChild(f);
		else if (typeof f === 'string') block.append(f);
	}

	if (!addBaseControls) return block;

	const wrap = createElement('div', { class: 'builderWrap' });

	const deleteButton = drawDeleteButton();
	deleteButton.classList.add('builderTrailingControls');
	deleteButton.addEventListener('click', () => {
		const parent = wrap.parentElement;
		wrap.dispatchEvent(new Event('change', { bubbles: true }));
		wrap.remove();
		undo('Restore deleted block').then(() => { if (parent) { parent.appendChild(wrap); parent.dispatchEvent(new Event('change', { bubbles: true })); } });
	});

	wrap.append(
		drawHandle(),
		block,
		deleteButton,
	);

	return wrap;
}

export function readBuilderItem(item: *, customOptionsFields: * = [], cases: *) {
	const firstBlock = item.querySelector(':scope > .builderBlock');
	const header = item.querySelector('.builderItemControls');

	return {
		note: (header.querySelector('textarea[name=builderNote]'): any).value,
		ver: parseInt((header.querySelector('input[name=version]'): any).value, 10),
		id: (header.querySelector('input[name=id]'): any).value,
		body: readBuilderBlock(firstBlock, cases),
		// $FlowIssue Array#flat
		opts: readFields(header.querySelector('.builderCustomOptions li') ? header : header, customOptionsFields.flat(Infinity), cases),
	};
}

export function readBuilderBlock(element: *, cases: *) {
	const type = element.getAttribute('data-type');
	const BlockClass = cases[type];

	const data = { type, ...readFields(element, BlockClass.fields, cases) };

	const multiType = BlockClass.fields.find(({ type }) => type === 'multi');
	if (!multiType) {
		try {
			BlockClass.validate(data);
			element.classList.remove('builderBlock-error');
		} catch (e) {
			element.setAttribute('error', e.message);
			element.classList.add('builderBlock-error');
			throw e;
		}
	}

	return data;
}

function readFields(element, fields, cases) {
	return fields.reduce((acc, field) => {
		if (typeof field === 'string') return acc;
		const fieldElem = element.querySelector(`:scope > [name=${field.id}]`);
		const fieldModule = builderFields[field.type];
		if (fieldModule && typeof fieldModule.read === 'function') {
			acc[field.id] = fieldModule.read(fieldElem, field, cases);
		} else if (fieldElem) {
			acc[field.id] = (fieldElem: any).value;
		}
		return acc;
	}, {});
}

function drawFields(fields, data, cases) {
	return fields.map(field => {
		if (typeof field === 'string') return field;

		const fieldModule = builderFields[field.type];
		if (fieldModule) {
			return fieldModule.draw(data, field, cases);
		} else {
			const input = createElement('input', { type: field.type, name: field.id });
			(input: any).value = data[field.id] || '';
			return input;
		}
	});
}

const builderFields = {
	multi: {
		draw(data, field, cases = {}) {
			const rowWrapper = createElement('ul', { class: 'builderMulti', name: field.id });
			const addItem = itemData => {
				const block = drawBuilderBlock(itemData, cases);
				const li = document.createElement('li');
				li.appendChild(block);
				rowWrapper.appendChild(li);
				return block;
			};

			const items = data[field.id];
			items.forEach(addItem);

			const addCaseSelect = downcast(string.html`
				<select class="addBuilderBlock">
					<option>+ add a condition</option>
					${Object.entries(cases).map(([key, { text }]) => string._html`
						<option value="${key}">${text}</option>
					`)}
				</select>
			`, HTMLSelectElement);
			addCaseSelect.addEventListener('change', () => {
				const type = addCaseSelect.value;
				if (type !== '' && cases.hasOwnProperty(type)) {
					const block = addItem({ type, ...cases[type].defaultConditions });
					const firstInput = block.querySelector('input[type=text], input[type=number], textarea');
					if (firstInput) firstInput.focus();
				}

				addCaseSelect.selectedIndex = 0;
			});

			Sortable.create(rowWrapper, { group: 'block', handle: '.handle' });

			const fragment = document.createDocumentFragment();
			fragment.append(rowWrapper, addCaseSelect);
			return fragment;
		},
		read(elem, fields, cases) {
			const results = [];
			for (const block of elem.querySelectorAll(':scope > li > .builderWrap > .builderBlock')) {
				results.push(readBuilderBlock(block, cases));
			}
			return results;
		},
	},
	hidden: {
		draw(data, field) {
			const id = field.id;
			const input = createElement('input', { type: 'hidden', name: id });
			(input: any).value = data[id] || '';
			return input;
		},
	},
	number: {
		draw(data, field) {
			const id = field.id;
			const input = createElement('input', { type: 'number', name: id });
			(input: any).value = data[id] || '';
			return input;
		},
		read(elem) {
			return parseInt((elem: any).value, 10);
		},
	},
	check: {
		draw(data, field) {
			const id = field.id;
			const input = createElement('input', { type: 'checkbox' });
			(input: any).checked = !!data[id];
			const label = createElement('label', { name: id, text: field.label });
			label.prepend(input);
			return label;
		},
		read(elem) {
			const input = elem.querySelector('input');
			return input ? input.checked : false;
		},
	},
	checkset: {
		uid: 0,
		draw(data, field) {
			const id = field.id;
			const prefixId = this.uid++;
			const wrap = createElement('span', { class: 'checkset', name: field.id });
			field.items.forEach((e, idx) => {
				const itemId = `checkset-${prefixId}-${idx}X`;
				const box = createElement('input', { type: 'checkbox', id: itemId, name: e });
				if (data.hasOwnProperty(id) && data[id].includes(e)) {
					(box: any).checked = true;
				}
				const label = createElement('label', { for: itemId, text: e });
				wrap.append(box, label);
			});
			return wrap;
		},
		read(elem, fields) {
			return fields.items.filter(e => {
				const child = elem.querySelector(`[name="${e}"]`);
				return child && (child: any).checked;
			});
		},
	},
	duration: {
		draw(data, field) {
			// Store as milliseconds like JavaScript Date
			let durr = data[field.id];
			durr /= 60 * 1000;
			const minutes = durr % 60;
			durr = (durr - minutes) / 60;
			const hours = durr % 24;
			durr = (durr - hours) / 24;
			const days = durr;

			const span = createElement('span', { class: 'durationField', name: field.id });
			const daysInput = createElement('input', { type: 'number', name: 'days' });
			(daysInput: any).value = days;
			const hoursInput = createElement('input', { type: 'number', name: 'hours' });
			(hoursInput: any).value = hours;
			const minutesInput = createElement('input', { type: 'number', name: 'minutes' });
			(minutesInput: any).value = minutes;
			span.append(daysInput, ' days ', hoursInput, ' hours ', minutesInput, ' minutes ');
			return span;
		},
		read(elem) {
			const days = parseFloat((elem.querySelector('[name=days]'): any).value) || 0;
			const hours = parseFloat((elem.querySelector('[name=hours]'): any).value) || 0;
			const minutes = parseFloat((elem.querySelector('[name=minutes]'): any).value) || 0;

			let duration = 0;
			duration += days * 24 * 60 * 60;
			duration += hours * 60 * 60;
			duration += minutes * 60;
			duration *= 1000;

			return duration;
		},
	},
	select: {
		draw(data, field) {
			const value = data[field.id];
			let entries = field.options;

			if (typeof entries === 'string') {
				entries = this.getPredefinedChoices(entries);
			}

			const dropdown = createElement('select', { name: field.id });
			entries.forEach(row => {
				let label, val;
				if (typeof row === 'string') {
					label = val = row;
				} else {
					label = row[0];
					val = row[1];
				}
				const option = createElement('option');
				option.textContent = label;
				(option: any).value = val;
				dropdown.appendChild(option);
			});
			(dropdown: any).value = value;
			return dropdown;
		},
		getPredefinedChoices(name) {
			if (name === 'COMPARISON') {
				return [
					['exactly', '=='],
					['not', '!='],
					['more than', '>'],
					['less than', '<'],
					['at least', '>='],
					['at most', '<='],
				];
			} else {
				throw new Error(`Option set "${name}" is not defined`);
			}
		},
	},
};
