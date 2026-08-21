/* @noflow */
/* eslint import-x/no-nodejs-modules: 0 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import generateModule from '@babel/generator';
import flowRemoveTypes from 'flow-remove-types';

const generate = generateModule.default || generateModule;
const MODULE_NAMESPACE = 'res-options-module';
const HOST_INDEX_NAMESPACE = 'res-options-host-index';
const HOST_NAMESPACE = 'res-options-host';
const INDEX_NAMESPACE = 'res-options-index';
const VIRTUAL_ID = 'res-options-metadata';

const DISPLAY_PROPERTIES = new Set([
	'alwaysEnabled',
	'asLongAs',
	'bodyClass',
	'category',
	'description',
	'descriptionRaw',
	'disabledByDefault',
	'hidden',
	'include',
	'keywords',
	'moduleName',
	'options',
	'exclude',
	'permissions',
	'sort',
]);

const OPTIONS_PAGE_STAGES = new Set(['always', 'onInit']);

const HOST_PROPERTIES = new Set([
	'attribution',
	'domains',
	'landingPage',
	'logo',
	'name',
	'options',
	'permissions',
]);

function parserOptions() {
	return {
		sourceType: 'module',
		plugins: ['flow', 'jsx', 'objectRestSpread', 'optionalChaining'],
	};
}

function parseProgram(source) {
	return parse(source, parserOptions()).program;
}

function unwrapDeclaration(statement) {
	return statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement;
}

function collectPatternNames(pattern, names) {
	if (!pattern) return;
	switch (pattern.type) {
		case 'Identifier':
			names.add(pattern.name);
			break;
		case 'ArrayPattern':
			for (const item of pattern.elements) collectPatternNames(item, names);
			break;
		case 'ObjectPattern':
			for (const property of pattern.properties) {
				collectPatternNames(property.value || property.argument, names);
			}
			break;
		case 'AssignmentPattern':
			collectPatternNames(pattern.left, names);
			break;
		case 'RestElement':
			collectPatternNames(pattern.argument, names);
			break;
		default:
			break;
	}
}

function declaredNames(statement) {
	const declaration = unwrapDeclaration(statement);
	const names = new Set();
	if (declaration.type === 'ImportDeclaration') {
		for (const specifier of declaration.specifiers) names.add(specifier.local.name);
	} else if (declaration.type === 'VariableDeclaration') {
		for (const item of declaration.declarations) collectPatternNames(item.id, names);
	} else if ((declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') && declaration.id) {
		names.add(declaration.id.name);
	}
	return names;
}

function isReferenceIdentifier(node, parent, key) {
	if (node.type !== 'Identifier' || !parent) return node.type === 'Identifier';
	if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed) return false;
	if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod') && key === 'key' && !parent.computed) return false;
	if ((parent.type === 'VariableDeclarator' && key === 'id') ||
		((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && key === 'id') ||
		((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod') && key === 'params') ||
		parent.type.startsWith('Import') ||
		(parent.type === 'ExportSpecifier' && key === 'exported') ||
		((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label')) return false;
	return true;
}

function collectIdentifiers(node, names = new Set(), parent = null, parentKey = null) {
	if (!node || typeof node !== 'object') return names;
	if (node.type === 'Identifier' && isReferenceIdentifier(node, parent, parentKey)) names.add(node.name);
	for (const [key, value] of Object.entries(node)) {
		if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments' || key === 'typeAnnotation' || key === 'returnType' || key === 'typeParameters' || key === 'superTypeParameters' || key === 'implements' || key === 'predicate') continue;
		if (Array.isArray(value)) {
			for (const item of value) collectIdentifiers(item, names, node, key);
		} else {
			collectIdentifiers(value, names, node, key);
		}
	}
	return names;
}

function memberPropertyName(node) {
	if (!node || node.type !== 'MemberExpression' || node.object.type !== 'Identifier' || node.object.name !== 'module') return null;
	if (!node.computed && node.property.type === 'Identifier') return node.property.name;
	if (node.computed && node.property.type === 'StringLiteral') return node.property.value;
	return null;
}

function isMetadataAssignment(statement) {
	if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'AssignmentExpression') return false;
	return DISPLAY_PROPERTIES.has(memberPropertyName(statement.expression.left));
}

function optionsPageStage(statement) {
	if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'AssignmentExpression') return null;
	const name = memberPropertyName(statement.expression.left);
	return OPTIONS_PAGE_STAGES.has(name) ? name : null;
}

function hasModuleDeclaration(statement) {
	const declaration = unwrapDeclaration(statement);
	return declaration.type === 'VariableDeclaration' && declaration.declarations.some(item =>
		item.id.type === 'Identifier' && item.id.name === 'module');
}

function selectDependencies(program, initialStatements) {
	const bindings = new Map();
	for (const statement of program.body) {
		for (const name of declaredNames(statement)) bindings.set(name, statement);
	}

	const selected = new Set(initialStatements);
	const pending = [...initialStatements];
	while (pending.length) {
		const statement = pending.pop();
		for (const name of collectIdentifiers(statement)) {
			const dependency = bindings.get(name);
			if (!dependency || selected.has(dependency)) continue;
			selected.add(dependency);
			pending.push(dependency);
		}
	}

	return program.body.filter(statement => selected.has(statement));
}

function emit(statements) {
	const code = generate({
		type: 'File',
		program: {
			type: 'Program',
			sourceType: 'module',
			body: statements,
			directives: [],
		},
	}, { comments: false, compact: false }).code;
	return flowRemoveTypes(code, { pretty: true, all: true }).toString();
}

export function extractModuleMetadata(source, filename = 'module.js') {
	const program = parseProgram(source);
	const initial = program.body.filter(statement => hasModuleDeclaration(statement) || isMetadataAssignment(statement));
	if (!initial.some(hasModuleDeclaration)) throw new Error(`${filename} does not export a module declaration`);
	const stageStubs = program.body
		.map(optionsPageStage)
		.filter(Boolean)
		.map(stage => parseProgram(`module.${stage} = () => {};`).body[0]);
	return emit([...selectDependencies(program, initial), ...stageStubs]);
}

function propertyName(property) {
	if (!property.computed && property.key.type === 'Identifier') return property.key.name;
	if (property.key.type === 'StringLiteral') return property.key.value;
	return null;
}

export function extractHostMetadata(source, filename = 'host.js') {
	const program = parseProgram(source);
	const originalExport = program.body.find(statement => statement.type === 'ExportDefaultDeclaration');
	let expression = originalExport && originalExport.declaration;
	if (expression && expression.type === 'Identifier') {
		for (const statement of program.body) {
			const declaration = unwrapDeclaration(statement);
			if (declaration.type !== 'VariableDeclaration') continue;
			const binding = declaration.declarations.find(item => item.id.type === 'Identifier' && item.id.name === expression.name);
			if (binding) {
				expression = binding.init;
				break;
			}
		}
	}
	if (!expression || expression.type !== 'NewExpression' || expression.arguments.length < 2 || expression.arguments[1].type !== 'ObjectExpression') {
		throw new Error(`${filename} does not default-export a Host instance`);
	}

	const moduleId = source.slice(expression.arguments[0].start, expression.arguments[0].end);
	const metadataProperties = expression.arguments[1].properties
		.filter(property => HOST_PROPERTIES.has(propertyName(property)))
		.map(property => source.slice(property.start, property.end));
	const synthetic = parseProgram(`export default new Host(${moduleId}, {${metadataProperties.join(',')}, detect() { return null; }, handleLink() { return { type: 'TEXT', src: '' }; }});`).body[0];
	const initial = [synthetic];
	return emit([...selectDependencies(program, initial).filter(statement => statement !== originalExport), synthetic]);
}

function resolveRelative(importPath, resolveDir) {
	const base = path.resolve(resolveDir, importPath);
	for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
	}
	return null;
}

function optionsMetadataPlugin() {
	const modulesDir = path.resolve('lib/modules');
	const hostsDir = path.join(modulesDir, 'hosts');
	const moduleIndex = path.join(modulesDir, 'index.js');
	const hostIndex = path.join(hostsDir, 'index.js');

	return {
		name: 'options-metadata',
		setup(build) {
			build.onResolve({ filter: new RegExp(`^${VIRTUAL_ID}$`) }, () => ({
				path: moduleIndex,
				namespace: INDEX_NAMESPACE,
			}));

			build.onLoad({ filter: /.*/, namespace: INDEX_NAMESPACE }, async args => ({
				contents: await fs.promises.readFile(args.path, 'utf8'),
				loader: 'js',
				resolveDir: path.dirname(args.path),
			}));

			build.onResolve({ filter: /^\./, namespace: INDEX_NAMESPACE }, args => {
				const resolved = resolveRelative(args.path, args.resolveDir);
				if (!resolved) return null;
				return { path: resolved, namespace: MODULE_NAMESPACE, sideEffects: false };
			});

			build.onLoad({ filter: /.*/, namespace: MODULE_NAMESPACE }, async args => ({
				contents: extractModuleMetadata(await fs.promises.readFile(args.path, 'utf8'), args.path),
				loader: 'js',
				resolveDir: path.dirname(args.path),
			}));

			build.onResolve({ filter: /^\./, namespace: MODULE_NAMESPACE }, args => {
				const resolved = resolveRelative(args.path, args.resolveDir);
				if (!resolved) return null;
				if (resolved === hostIndex) return { path: resolved, namespace: HOST_INDEX_NAMESPACE, sideEffects: false };
				if (resolved.startsWith(`${hostsDir}${path.sep}`)) return { path: resolved, namespace: HOST_NAMESPACE, sideEffects: false };
				return { path: resolved, namespace: 'file', sideEffects: false };
			});

			build.onLoad({ filter: /.*/, namespace: HOST_INDEX_NAMESPACE }, async args => ({
				contents: await fs.promises.readFile(args.path, 'utf8'),
				loader: 'js',
				resolveDir: path.dirname(args.path),
			}));

			build.onResolve({ filter: /^\./, namespace: HOST_INDEX_NAMESPACE }, args => {
				const resolved = resolveRelative(args.path, args.resolveDir);
				return resolved ? { path: resolved, namespace: HOST_NAMESPACE, sideEffects: false } : null;
			});

			build.onLoad({ filter: /.*/, namespace: HOST_NAMESPACE }, async args => ({
				contents: extractHostMetadata(await fs.promises.readFile(args.path, 'utf8'), args.path),
				loader: 'js',
				resolveDir: path.dirname(args.path),
			}));

			build.onResolve({ filter: /^\./, namespace: HOST_NAMESPACE }, args => {
				const resolved = resolveRelative(args.path, args.resolveDir);
				return resolved ? { path: resolved, namespace: 'file', sideEffects: false } : null;
			});
		},
	};
}

export default optionsMetadataPlugin;
