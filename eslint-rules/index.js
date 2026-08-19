// Three lint rules vendored from upstream RES's own eslint plugins.
//
// `eslint-plugin-dollar-sign`, `eslint-plugin-no-useless-assign` and
// `eslint-plugin-prefer-spread` were published by Erik Desjardins, a RES
// maintainer, in 2016-2019 and never updated. They are MIT, which is one-way
// compatible with this project's GPL-3.0, so they are copied here rather than
// replaced — the alternative was dropping three rules the codebase is written
// against, to avoid depending on three packages that will never ship again.
//
// They are carried faithfully: the matching logic is unchanged, line for line.
// What changed is the wrapper, because ESLint 9 removed the two things all three
// relied on —
//
//   * the function-style rule (`module.exports = function (context) {}` with a
//     `module.exports.schema`), replaced by `{ schema, create }`; and
//   * `context.getScope()` / `context.getDeclaredVariables()`, replaced by the
//     same methods on `sourceCode`.
//
// `fixupPluginRules` from `@eslint/compat` would paper over both, but it would
// also keep three dead dependencies in the tree to do it.
//
// They are ESM because this package is `"type": "module"`, which is also the
// trap: as CommonJS they loaded as ESM, `module` was not defined, and the rules
// silently resolved to nothing rather than failing.
//
// Original copyright and licence: see LICENSE-erikdesjardins in this directory.

import dollarSign from './dollar-sign.js';
import noUselessAssign from './no-useless-assign.js';
import preferObjectSpread from './prefer-object-spread.js';

export default {
	meta: { name: 'eslint-plugin-res-slim-vendored', version: '1.0.0' },
	rules: {
		'dollar-sign': dollarSign,
		'no-useless-assign': noUselessAssign,
		'prefer-object-spread': preferObjectSpread,
	},
};
