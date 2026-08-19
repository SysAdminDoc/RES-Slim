// ESLint 10 flat config.
//
// Migrated from `.eslintrc.json` on 2026-08-19. ESLint 8 went EOL 2024-10-05 and
// ESLint 9 followed on 2026-08-06, so v10 is the only supported target and it
// removes eslintrc entirely.
//
// What the migration cost, in full, so nobody has to diff two formats to find out:
//
//   * `require-jsdoc` and `valid-jsdoc` are gone from core. Both were already set
//     to 0 here, so nothing was being enforced and nothing is lost.
//   * `eslint-plugin-filenames` (2018, no flat support) is replaced by
//     `eslint-plugin-check-file`. Its `filename-naming-convention` is a glob-to-
//     pattern check and cannot express `match-exported` — "the filename must
//     equal the name of the thing this file default-exports". That specific
//     coverage is dropped; `filename-naming-convention` holds the weaker
//     property that module filenames stay camelCase.
//   * `eslint-plugin-import` is replaced by `eslint-plugin-import-x`, whose
//     upstream peer range stops at ESLint 9. Rule names are identical under the
//     `import-x/` prefix. `import/imports-first` was a deprecated alias of
//     `import/first` and is not carried over — `first` was already enabled.
//   * `eslint-plugin-dollar-sign`, `eslint-plugin-no-useless-assign` and
//     `eslint-plugin-prefer-spread` are RES's own, MIT, and unmaintained since
//     2019. They are vendored into `eslint-rules/` rather than dropped.
//   * `eslint-plugin-flowtype` is deprecated and pins `eslint@^8`, but its
//     problem is the peer range and the old context API, not the parser — so
//     `fixupPluginRules` carries it. The parser stays `@babel/eslint-parser`.
//     `hermes-eslint` was evaluated and rejected: it has no support surface for
//     pre-0.87 Flow syntax, and 163 files here use existential types (`Module<*>`).
//   * `eslint-plugin-ava` moved 14 -> 17, which requires ESLint >= 10 and flat.
//
// The core formatting rules (`indent`, `quotes`, `comma-dangle`, ...) are
// deprecated in v10 but still ship and still run, so they are kept as-is. When
// they are finally removed, `@stylistic/eslint-plugin` is the successor and the
// rule names carry over unchanged behind a `@stylistic/` prefix.
//
// Flat config does not cascade, so the five nested `.eslintrc.json` files are
// folded in below as `files`-scoped blocks, in the same order the cascade
// applied them.

import js from '@eslint/js';
import { fixupPluginRules } from '@eslint/compat';
import babelParser from '@babel/eslint-parser';
import globals from 'globals';
import ava from 'eslint-plugin-ava';
import importX from 'eslint-plugin-import-x';
import checkFile from 'eslint-plugin-check-file';
import flowtype from 'eslint-plugin-flowtype';

import vendored from './eslint-rules/index.js';

export default [
	{
		// Replaces `.eslintignore`, which flat config does not read.
		ignores: [
			'dist/**',
			'lib/vendor/*.js',
			'!lib/vendor/index.js',
			// Reference userscripts kept for provenance, not built or imported.
			// lib/modules/hideAll.js is the rewrite of this one.
			'*.user.js',
			// esbuild output from `loadModule`/`bundleEntry`. Gitignored, cleared
			// before every unit run, and never source. The old setup never saw them
			// because eslintrc linted `.js` only and these are `.cjs`/`.mjs`; under
			// flat config they were 957,766 of 958,585 findings on the first run —
			// the same "a check reading its own build output" trap that
			// `scripts/run-unit-tests.mjs` was written to close for the locale scan.
			'tests/unit/.tmp-*/**',
			// Reference copies of other people's userscripts, kept for provenance.
			'.research/source-userscripts/**',
		],
	},
	js.configs.all,
	{
		// Deliberately unscoped, matching `js.configs.all` above it. Give this block
		// a `files` key and every extension it omits keeps the whole of `all` with
		// none of the overrides below — which is how the first run reported
		// `no-magic-numbers` and `sort-keys` against files this project has never
		// held to either.
		languageOptions: {
			parser: babelParser,
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				requireConfigFile: false,
				babelOptions: {
					babelrc: false,
					configFile: false,
					// Babel 8 configures syntax through `parserOpts.plugins`, not through
					// `@babel/plugin-syntax-*` entries in `plugins`. Getting this wrong
					// is silent in the worst way: every Flow-annotated file becomes one
					// fatal parse error and is otherwise **not linted at all**, so the
					// report gets shorter and looks like an improvement. It cost 298
					// files' worth of coverage on the first Babel 8 run here.
					parserOpts: {
						plugins: ['flow', 'importAttributes'],
					},
				},
			},
			globals: {
				...globals.browser,
				...globals.node,
				...globals.es2021,
			},
		},
		plugins: {
			ava,
			'import-x': importX,
			'check-file': checkFile,
			flowtype: fixupPluginRules(flowtype),
			vendored,
		},
		settings: {
			'import-x/ignore': [
				'node_modules',
				'\\.(json|png|gif|html|scss)$',
			],
		},
		rules: {
			// `ava.configs.recommended` is a two-entry flat array: [0] is the JS
			// ruleset, [1] lints `package.json` through `@eslint/json`, which this
			// repo does not install and does not need — this project shims `ava`
			// rather than running it (see tests/unit/utils-specs.test.mjs).
			...ava.configs.recommended[0].rules,
			'ava/no-ignored-test-files': 0,

			'flowtype/boolean-style': 2,
			'flowtype/define-flow-type': 2,
			'flowtype/delimiter-dangle': [2, 'always-multiline'],
			'flowtype/generic-spacing': 2,
			'flowtype/no-primitive-constructor-types': 2,
			'flowtype/no-types-missing-file-annotation': 2,
			'flowtype/no-unused-expressions': 2,
			'flowtype/no-weak-types': [2, { any: false }],
			'flowtype/require-valid-file-annotation': [2, 'always'],
			'flowtype/space-after-type-colon': 2,
			'flowtype/space-before-generic-bracket': 2,
			'flowtype/space-before-type-colon': 2,
			'flowtype/type-id-match': [2, '^([A-Z][a-z0-9]+)+$'],
			'flowtype/type-import-style': [2, 'declaration'],
			'flowtype/union-intersection-spacing': 2,
			'flowtype/valid-syntax': 2,

			'vendored/dollar-sign': [2, 'ignoreProperties'],

			'vendored/no-useless-assign': 2,

			'vendored/prefer-object-spread': 2,

			'function-call-argument-newline': 0,

			// `filenames/match-exported` has no equivalent here; see the header. The
			// replacement is deliberately weaker: alphanumeric only, which accepts
			// both `showImages.js` (camelCase, named for its export) and
			// `filteReddit/Case.js` or `utils/Thing.js` (PascalCase, named for the
			// class they export) while still rejecting kebab-case and snake_case.
			// Pinning `CAMEL_CASE` here would flag 38 files that were correct under
			// the rule this replaces.
			// The underscore is for `watchers_d2x.js`, which has carried that name
			// since the upstream import and which `match-exported` accepted. A
			// replacement rule that rejects a file the old rule allowed is a new
			// rule, not a migration.
			'check-file/filename-naming-convention': [2, {
				'lib/**/*.js': '+([a-zA-Z0-9_])',
			}, { ignoreMiddleExtensions: true }],

			'import-x/no-restricted-paths': [2, { zones: [
				{ target: './lib/core', from: './lib/modules' },
				{ target: './lib/environment', from: './lib/modules' },
				{ target: './lib/environment', from: './lib/core' },
				{ target: './lib/utils', from: './lib/modules' },
				{ target: './lib/utils', from: './lib/core' },
				{ target: './lib/vendor', from: './lib/modules' },
				{ target: './lib/vendor', from: './lib/core' },
			] }],
			'import-x/default': 2,
			'import-x/dynamic-import-chunkname': 2,
			'import-x/exports-last': 0,
			'import-x/extensions': [0, { js: 'always', json: 'always' }], // FIXME Extensions must be added
			'import-x/first': 2,
			'import-x/group-exports': 0,
			'import-x/max-dependencies': 0,
			'import-x/newline-after-import': 2,
			'import-x/no-absolute-path': 2,
			'import-x/no-amd': 2,
			'import-x/no-anonymous-default-export': 0,
			'import-x/no-commonjs': 2,
			'import-x/no-cycle': 0,
			'import-x/no-default-export': 0,
			'import-x/no-deprecated': 2,
			'import-x/no-duplicates': 2,
			'import-x/no-dynamic-require': 0,
			'import-x/no-extraneous-dependencies': 2,
			'import-x/no-internal-modules': 0,
			'import-x/no-mutable-exports': 0,
			'import-x/no-named-as-default': 2,
			'import-x/no-named-as-default-member': 2,
			'import-x/no-named-default': 2,
			'import-x/no-namespace': 0,
			'import-x/no-nodejs-modules': 2,
			'import-x/no-self-import': 2,
			'import-x/no-unassigned-import': 0,
			'import-x/no-unresolved': [2, { ignore: ['ava'] }],
			'import-x/no-useless-path-segments': 0,
			'import-x/no-webpack-loader-syntax': 0,
			'import-x/order': 2,
			'import-x/prefer-default-export': 0,
			'import-x/unambiguous': 0,

			'no-alert': 0,
			'no-bitwise': 0,
			'no-case-declarations': 0,
			'no-confusing-arrow': 0,
			'no-console': 0,
			'no-continue': 0,
			'no-div-regex': 0,
			'no-duplicate-imports': 0, // see import-x/no-duplicates (ESLint's rule doesn't handle Flow `import type`)
			'no-else-return': 0,
			'no-empty-function': [2, { allow: ['arrowFunctions', 'methods'] }],
			'no-extra-parens': [2, 'functions'], // "all" conflicts with no-return-assign and some other rules, unfortunately
			'no-implicit-coercion': [0, { boolean: false }],
			'no-inline-comments': 0,
			'no-inner-declarations': 0, // ES6 has block-scoped functions
			'no-invalid-this': 0,
			'no-lone-blocks': 0,
			'no-lonely-if': 0,
			'no-loop-func': 0,
			'no-magic-numbers': 0,
			'no-mixed-operators': 0,
			'no-multi-assign': 0,
			'no-multi-spaces': [2, { exceptions: { SwitchCase: true } }],
			'no-negated-condition': 0,
			'no-nested-ternary': 0,
			'no-param-reassign': 0,
			'no-plusplus': 0,
			'no-process-env': 0,
			'no-process-exit': 0,
			'no-prototype-builtins': 0,
			'no-restricted-globals': [2, 'alert'],
			'no-restricted-modules': 0, // see import-x/no-nodejs-modules
			'no-restricted-syntax': [2, {
				selector: 'ForStatement',
				message: 'No C-style for-loops; use for..of or Array.prototype methods.',
			}, {
				selector: "AssignmentExpression[left.property.name='options'] > ObjectExpression > Property > Literal.key[value=/ /]",
				message: 'No spaces in option names.',
			}, {
				selector: "Property[key.name='options'] > ObjectExpression > Property > Literal.key[value=/ /]",
				message: 'No spaces in option names.',
			}, {
				selector: 'ForInStatement',
				message: 'No for-in loops; use for..of with Object.keys/values/entries.',
			}, {
				selector: "BinaryExpression[operator='in']",
				message: 'No in keyword; use Set/Map or hasOwnProperty.',
			}],
			'no-shadow': 0,
			'no-sync': 0,
			'no-tabs': 0,
			'no-ternary': 0,
			'no-undef': [2, { typeof: true }],
			'no-undefined': 0,
			'no-underscore-dangle': 0,
			'no-unused-expressions': 2,
			// `caughtErrors` defaulted to 'none' through ESLint 8 and to 'all' from 9,
			// which surfaced 135 `catch (e)` bindings that are never read. Pinning it
			// back to 'none' keeps this migration a migration: the same code that
			// passed before passes now. Several of those catches do look worth
			// examining — `snapshot.js:250` swallows a `rollbackError` — but that is a
			// change to the product, not to the linter, and it is on the roadmap.
			'no-unused-vars': [2, { ignoreRestSiblings: true, caughtErrors: 'none' }],
			'no-use-before-define': [0, 'nofunc'],
			'no-useless-escape': 0,
			'no-warning-comments': 0,
			'array-bracket-newline': [2, 'consistent'],
			'array-callback-return': 0,
			'array-element-newline': [0, { multiline: true }],
			'arrow-parens': [2, 'as-needed'],
			'brace-style': [2, '1tbs', { allowSingleLine: true }],
			'callback-return': 0,
			camelcase: [2, { properties: 'never' }],
			'capitalized-comments': 0,
			'class-methods-use-this': 0,
			'comma-dangle': [2, 'always-multiline'],
			complexity: [0, 11],
			'consistent-return': 0, // Flow effectively does this, and does a better job
			'consistent-this': [2, 'this'], // do not alias `this`, use arrow functions
			curly: [2, 'multi-line'],
			'default-param-last': 0,
			'dot-location': [2, 'property'],
			'func-names': 0, // all anonymous functions should be arrows (when this is turned on)
			'func-style': [2, 'declaration', { allowArrowFunctions: true }],
			'function-paren-newline': [0, 'consistent'],
			'generator-star-spacing': [0, { before: false, after: true }], // disabled pending https://github.com/eslint/eslint/issues/6195
			'id-length': 0,
			'id-match': 0,
			'implicit-arrow-linebreak': 0,
			indent: [2, 'tab', { SwitchCase: 1, flatTernaryExpressions: true }],
			'init-declarations': 0,
			'linebreak-style': 0,
			'line-comment-position': 0,
			'lines-around-comment': [0, { allowBlockStart: true }],
			'lines-between-class-members': [2, 'always', { exceptAfterSingleLine: true }],
			'logical-assignment-operators': 0, // not supported in the Flow version used here
			'max-classes-per-file': 0,
			'max-depth': 0,
			'max-len': 0,
			'max-lines': 0,
			'max-lines-per-function': 0,
			'max-nested-callbacks': [2, 5],
			'max-params': 0,
			'max-statements': 0,
			'max-statements-per-line': 0,
			'multiline-comment-style': 0,
			'multiline-ternary': 0,
			'newline-after-var': [0, 'never'],
			'newline-before-return': 0,
			'newline-per-chained-call': 0,
			'object-curly-newline': 0,
			'object-curly-spacing': [2, 'always'],
			'object-property-newline': [2, { allowMultiplePropertiesPerLine: true }],
			'one-var': [2, { initialized: 'never' }],
			'one-var-declaration-per-line': [2, 'initializations'],
			'operator-assignment': [2, 'always'],
			'operator-linebreak': [2, 'after'],
			'padded-blocks': [2, 'never'],
			'prefer-named-capture-group': 0,
			'prefer-destructuring': 0,
			'prefer-object-spread': 2,
			'prefer-reflect': [2, { exceptions: ['defineProperty', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'getOwnPropertyNames', 'preventExtensions', 'delete'] }],
			'quote-props': [2, 'as-needed'],
			quotes: [2, 'single'],
			'require-atomic-updates': 0,
			'require-unicode-regexp': 0,
			'sort-imports': 0, // see import-x/order
			'sort-keys': 0,
			'sort-vars': 0,
			'space-before-function-paren': [2, {
				anonymous: 'never',
				named: 'never',
				asyncArrow: 'always',
			}],
			'spaced-comment': [2, 'always', { markers: [':', '::'] }],
			strict: [2, 'never'], // Babel inserts it for us
			'valid-typeof': [2, { requireStringLiterals: true }],
			'vars-on-top': 0,
			'wrap-iife': [2, 'inside'],

			// Restored coverage, not new rules.
			//
			// `eslint:all` in v8 enabled every core rule including the deprecated
			// ones. `js.configs.all` in v10 enables 199 of 292 and leaves every
			// deprecated rule off. 45 of those this config already set explicitly, so
			// they carried over untouched; these are the rest — rules that were being
			// enforced before this migration and would otherwise have switched
			// themselves off silently, which is the worst way for a linter to change.
			//
			// Deliberately not restored, because each is superseded by a rule already
			// enabled above: `indent-legacy` (alias of `indent`), `no-spaced-func`
			// (`func-call-spacing`), `no-native-reassign` (`no-global-assign`),
			// `no-negated-in-lhs` (`no-unsafe-negation`), `id-blacklist`
			// (`id-denylist`, and it was set to 0 here), `no-catch-shadow`
			// (`no-shadow`, set to 0 here), and `jsx-quotes` (no JSX in this project).
			//
			// When these are finally removed from core, `@stylistic/eslint-plugin` is
			// the successor and the names carry over behind a `@stylistic/` prefix.
			'array-bracket-spacing': 2,
			'arrow-spacing': 2,
			'block-spacing': 2,
			'comma-spacing': 2,
			'comma-style': 2,
			'computed-property-spacing': 2,
			'eol-last': 2,
			'func-call-spacing': 2,
			// Kept on: `localization.js` defers `require('dayjs')` until a date is
			// actually formatted, and each call carries a disable comment saying so.
			// Turning the rule off would make twelve deliberate annotations inert.
			'global-require': 2,
			'handle-callback-err': 2,
			'key-spacing': 2,
			'keyword-spacing': 2,
			'new-parens': 2,
			'no-buffer-constructor': 2,
			'no-extra-semi': 2,
			'no-floating-decimal': 2,
			'no-mixed-requires': 2,
			'no-mixed-spaces-and-tabs': 2,
			'no-multiple-empty-lines': 2,
			'no-new-object': 2,
			'no-new-require': 2,
			'no-new-symbol': 2,
			'no-path-concat': 2,
			'no-return-await': 0, // deprecated on correctness grounds, not style
			'no-trailing-spaces': 2,
			'no-whitespace-before-property': 2,
			'nonblock-statement-body-position': 2,
			'padding-line-between-statements': 2,
			'rest-spread-spacing': 2,
			semi: 2,
			'semi-spacing': 2,
			'semi-style': 2,
			'space-before-blocks': 2,
			'space-in-parens': 2,
			'space-infix-ops': 2,
			'space-unary-ops': 2,
			'switch-colon-spacing': 2,
			'template-curly-spacing': 2,
			'template-tag-spacing': 2,
			'wrap-regex': 0, // `eslint:all` had it on and it fires on every regex here
			'yield-star-spacing': 2,
		},
	},
	{
		// was examples/.eslintrc.json
		files: ['examples/**'],
		rules: {
			'import-x/no-unresolved': 0, // paths here will only work after the example is pasted into lib/
		},
	},
	{
		// was flow/.eslintrc.json
		files: ['flow/**'],
		rules: {
			'flowtype/no-dupe-keys': 0, // dupe keys in declarations are used for overloading
			'flowtype/no-weak-types': 0, // used in generic bounds
			'no-unused-vars': 0, // none of the flow declarations will be used directly
		},
	},
	{
		// was flow/lib/.eslintrc.json
		files: ['flow/lib/**'],
		rules: {
			'flowtype/boolean-style': 0, // lib files may be generated from TS so boolean style may differ
			'flowtype/type-id-match': 0, // type names in this dir are dictated by the API names, so we can't change them
		},
	},
	{
		// was lib/environment/.eslintrc.json — the only place `chrome.*` is declared,
		// which is what keeps extension APIs out of the rest of lib/.
		files: ['lib/environment/**'],
		languageOptions: {
			globals: { ...globals.webextensions },
		},
	},
	{
		// was tests/.eslintrc.json
		files: ['tests/**'],
		rules: {
			'flowtype/no-unused-expressions': 0,
			'flowtype/require-valid-file-annotation': 0,
			'import-x/no-commonjs': 0,
		},
	},
	{
		// Node-side tooling: the test suites, the build, the scripts, and this file.
		//
		// None of this was linted before — eslintrc lints `.js` only, and all of it
		// is `.mjs` — so flat config brings roughly a hundred files into scope for
		// the first time. That is real new coverage and worth keeping, but three
		// rules here exist to protect the *shipped bundle* and say nothing about a
		// Node program:
		//
		//   * `import-x/no-nodejs-modules` — 605 of the first run's findings. A
		//     content script must not import `node:fs`; a test runner must.
		//   * `import-x/no-extraneous-dependencies` — devDependencies are exactly
		//     what this code is allowed to use.
		//   * `import-x/dynamic-import-chunkname` — there is no bundler here to name
		//     a chunk for.
		files: ['tests/**', 'scripts/**', 'build.js', 'manifest.config.js', 'eslint.config.js', 'eslint-rules/**', '*.mjs'],
		languageOptions: {
			globals: { ...globals.node },
		},
		rules: {
			'import-x/no-nodejs-modules': 0,
			'import-x/no-extraneous-dependencies': 0,
			'import-x/dynamic-import-chunkname': 0,
			'flowtype/require-valid-file-annotation': 0,
			'check-file/filename-naming-convention': 0,
		},
	},
	{
		// e2e specs reach `chrome.*` inside `page.evaluate`, where the callback is
		// serialized and runs in the extension's context rather than in Node.
		files: ['tests/e2e/**'],
		languageOptions: {
			globals: { ...globals.webextensions },
		},
	},
	{
		// The vendored lint rules are third-party code kept verbatim; they are
		// pre-ES6 CommonJS-style sources and are not held to this repo's style.
		files: ['eslint-rules/**'],
		rules: {
			'no-var': 0,
			'vars-on-top': 0,
			'func-style': 0,
			'prefer-arrow-callback': 0,
			'prefer-template': 0,
			'no-plusplus': 0,
			strict: 0,
			'lines-around-directive': 0,
			'unicode-bom': 0,
		},
	},
];
