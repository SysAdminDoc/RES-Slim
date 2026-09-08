/* @flow */

// The choices an enum or select row draws.
//
// `getOptions()` shallow-spreads, so `optionObject.values` is the module's own
// array. Pushing the "(not available)" placeholder into it added a phantom
// choice to every row drawn afterwards, kept the dropped value re-selectable,
// and the mutation lived for the session: `search.js`'s domain and `modified.js`
// read the same array. This returns a copy and never touches the original.

type OptionChoice = { name: string, value: mixed, style?: string };

export function renderableValues(optionObject: { value: mixed, values: $ReadOnlyArray<OptionChoice> }): OptionChoice[] {
	const values = [...optionObject.values];
	// A stored value an upgrade dropped is still shown, so the reader can see what
	// they had rather than finding the row silently on something else.
	if (optionObject.value && !values.some(({ value }) => value === optionObject.value)) {
		values.push({ name: `${String(optionObject.value)} (not available)`, value: optionObject.value });
	}
	return values;
}
