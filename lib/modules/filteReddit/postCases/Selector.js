/* @flow */

import { Case } from '../Case';

export class Selector extends Case {
	static text = 'Selector';

	static parseCriterion(input: *) { return { patt: input }; }

	static defaultConditions = { patt: '' };
	static fields = ['thing matches CSS selector ', { type: 'text', id: 'patt' }];
	static slow = 10; // Can cause reflow, e.g. by using `:contains()`

	static pattern = 'string';

	trueText = `selector('${this.conditions.patt.replace(/\'/g, '\\\'')}')`;
	falseText = `selector(':not(${this.conditions.patt.replace(/\'/g, '\\\'')})')`;

	isValid() {
		try {
			return this.value.patt && !!document.querySelector(this.value.patt) !== undefined;
		} catch (e) {
			return false;
		}
	}

	evaluate(thing: *) {
		const patt = this.value.patt;
		return thing.element.matches(patt) ||
			thing.entry.matches(patt) ||
			!!thing.entry.querySelector(patt);
	}
}
