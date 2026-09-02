import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modulesDir = path.join(repoRoot, 'lib', 'modules');
const cssModulesDir = path.join(repoRoot, 'lib', 'css', 'modules');
const indexSource = fs.readFileSync(path.join(modulesDir, 'index.js'), 'utf8');
const resStyles = fs.readFileSync(path.join(repoRoot, 'lib', 'css', 'res.scss'), 'utf8');
const registrySource = fs.readFileSync(path.join(repoRoot, 'lib', 'core', 'modules', 'modules.js'), 'utf8');
const stylelessModules = JSON.parse(fs.readFileSync(path.join(modulesDir, 'styleless-modules.json'), 'utf8'));
const brokenFeatures = JSON.parse(fs.readFileSync(path.join(repoRoot, 'lib', 'core', 'modules', 'broken-features.json'), 'utf8'));

const moduleFiles = fs.readdirSync(modulesDir)
	.filter(filename => filename.endsWith('.js') && filename !== 'index.js')
	.filter(filename => {
		const source = fs.readFileSync(path.join(modulesDir, filename), 'utf8');
		return source.includes('export const module') && source.includes('new Module(');
	})
	.map(filename => filename.slice(0, -3))
	.sort();

const registeredFiles = Array.from(indexSource.matchAll(/^import \{ module as \w+ \} from '\.\/(\w+)';$/gm), match => match[1]).sort();
const exportedAliases = Array.from(indexSource.matchAll(/^import \{ module as (\w+) \} from '\.\/\w+';$/gm), match => match[1]).sort();
const exportBlock = indexSource.match(/export \{([\s\S]+)\}\s*$/);
const exportedModules = exportBlock ? exportBlock[1].split(',').map(name => name.trim()).filter(Boolean).sort() : [];
const moduleIDs = new Map(moduleFiles.map(moduleName => {
	const source = fs.readFileSync(path.join(modulesDir, `${moduleName}.js`), 'utf8');
	const match = source.match(/new Module\('([^']+)'\)/);
	return [moduleName, match ? match[1] : ''];
}));

function listJavaScriptFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
		return /\.m?js$/.test(entry.name) ? [entryPath] : [];
	});
}

test('every module file is registered and exported exactly once', () => {
	assert.deepEqual(registeredFiles, moduleFiles, 'lib/modules/index.js must import every module file');
	assert.deepEqual(exportedModules, exportedAliases, 'lib/modules/index.js must export every imported module');
	assert.equal(new Set(registeredFiles).size, registeredFiles.length, 'module imports must not be duplicated');
});

test('module ids follow their filenames except for the preserved RESMenu compatibility id', () => {
	const exceptions = new Map([['menu', 'RESMenu']]);
	const mismatches = moduleFiles.filter(moduleName => moduleIDs.get(moduleName) !== (exceptions.get(moduleName) || moduleName));
	assert.deepEqual(mismatches, [], 'a module id must be derived from its filename unless the compatibility map says otherwise');
});

test('every module has a non-empty description', () => {
	const missing = moduleFiles.filter(moduleName => {
		const source = fs.readFileSync(path.join(modulesDir, `${moduleName}.js`), 'utf8');
		const match = source.match(/module\.description\s*=\s*(['"`])([\s\S]*?)\1\s*;/);
		return !match || !match[2].trim();
	});

	assert.deepEqual(missing, [], 'each module must assign a non-empty description');
});

test('every module owns a stylesheet or explicitly declares itself styleless', () => {
	assert.equal(new Set(stylelessModules).size, stylelessModules.length, 'styleless module declarations must be unique');

	const styleless = new Set(stylelessModules);
	const cssOwners = new Set(fs.readdirSync(cssModulesDir)
		.filter(filename => /^_.*\.scss$/.test(filename) && filename !== '_toastHost.scss')
		.map(filename => filename.slice(1, -5)));
	const missingOwnership = moduleFiles.filter(moduleName => !styleless.has(moduleName) && !cssOwners.has(moduleName));
	const staleStyleless = stylelessModules.filter(moduleName => !moduleFiles.includes(moduleName) || cssOwners.has(moduleName));
	const unimportedStyles = [...cssOwners].filter(moduleName => !resStyles.includes(`@use 'modules/${moduleName}';`));

	assert.deepEqual(missingOwnership, [], 'new modules must add an owned stylesheet or an explicit styleless declaration');
	assert.deepEqual(staleStyleless, [], 'styleless declarations must name a current module without a stylesheet');
	assert.deepEqual(unimportedStyles, [], 'each owned module stylesheet must be imported by res.scss');
});

test('broken feature overrides are local, valid, and never remotely fetched', () => {
	assert.ok(Array.isArray(brokenFeatures), 'broken-features.json must contain an array');
	assert.equal(new Set(brokenFeatures).size, brokenFeatures.length, 'broken feature ids must be unique');
	assert.deepEqual(brokenFeatures.filter(id => ![...moduleIDs.values()].includes(id)), [], 'broken features must name registered module ids');
	assert.match(registrySource, /from '\.\/broken-features\.json'/);
	assert.doesNotMatch(registrySource, /fetch\s*\(|https?:\/\//, 'the kill switch must remain an in-bundle file');
});

test('module declarations avoid Flow existential syntax', () => {
	const existentialGeneric = /Module\s*<\s*\*\s*>/m;
	const sourceFiles = ['lib', 'scripts', 'tests'].flatMap(directory => listJavaScriptFiles(path.join(repoRoot, directory)));
	const offenders = sourceFiles
		.filter(filename => existentialGeneric.test(fs.readFileSync(filename, 'utf8')))
		.map(filename => path.relative(repoRoot, filename).replaceAll('\\', '/'));

	const whitespaceBait = ['const module: Module<', ' *> = value;'].join('');
	const multilineBait = ['const module: Module<', '\n\t*\n> = value;'].join('');
	assert.equal(existentialGeneric.test(whitespaceBait), true, 'the guard must catch whitespace variants');
	assert.equal(existentialGeneric.test(multilineBait), true, 'the guard must catch multiline variants');
	assert.deepEqual(offenders, [], 'module declarations must use an explicit option-map type');
});
