/* @flow */

// Note this class shadows the global `Date`, so nothing in here can call
// `new Date(...)` or `Date.now()` — both would resolve to the class. That is why
// the two helpers are imported rather than written inline.
import { nowMs, parseDateInput } from '../../../utils/localization';
import { Case } from '../Case';

const options = [
	['before', '<'],
	['on or after', '>='],
];

export class Date extends Case {
	static text = 'Date';

	static defaultConditions = { op: '<', date: '2020-12-30' };
	static fields = ['today is ', { type: 'select', options, id: 'op' }, ' ', { type: 'text', id: 'date' }];

	value = { op: this.conditions.op, date: parseDateInput(this.conditions.date) };

	isValid() { return !Number.isNaN(this.value.date); }

	evaluate() {
		return (this.value.op === '<') === (nowMs() < this.value.date);
	}
}
