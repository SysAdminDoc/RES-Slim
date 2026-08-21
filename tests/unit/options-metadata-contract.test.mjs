import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { extractHostMetadata, extractModuleMetadata } from '../../build/optionsMetadataPlugin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('module metadata extraction retains settings schema without runtime hooks', () => {
	const source = `
		/* @flow */
		import heavyRuntime from 'large-runtime';
		import { Module } from '../core/module';
		const description = 'sampleDescription';
		export const module: Module<*> = new Module('sample');
		module.moduleName = 'sampleName';
		module.category = 'sampleCategory';
		module.description = description;
		module.options = { enabled: { title: 'enabledTitle', type: 'boolean', value: true } };
		module.always = () => heavyRuntime();
		module.beforeLoad = () => heavyRuntime();
	`;

	const output = extractModuleMetadata(source, 'sample.js');
	assert.match(output, /new Module\(['"]sample['"]\)/);
	assert.match(output, /module\.moduleName = ['"]sampleName['"]/);
	assert.match(output, /module\.category = ['"]sampleCategory['"]/);
	assert.match(output, /module\.description = description/);
	assert.match(output, /module\.options =/);
	assert.doesNotMatch(output, /large-runtime|beforeLoad|heavyRuntime/);
	assert.match(output, /module\.always = \(\) => \{\}/);
});

test('every module source produces metadata with the same declared display fields', () => {
	const modulesDir = path.join(root, 'lib/modules');
	const index = fs.readFileSync(path.join(modulesDir, 'index.js'), 'utf8');
	const moduleFiles = [...index.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]
		.map(match => path.join(modulesDir, `${match[1]}.js`));
	assert.ok(moduleFiles.length > 100, 'expected the full module catalog');

	for (const filename of moduleFiles) {
		const source = fs.readFileSync(filename, 'utf8');
		const output = extractModuleMetadata(source, filename);
		assert.match(output, /new Module\(/, `${path.basename(filename)} lost its module ID`);
		for (const field of ['moduleName', 'category', 'description', 'options']) {
			if (source.includes(`module.${field} =`)) {
				assert.ok(output.includes(`module.${field} =`), `${path.basename(filename)} lost ${field}`);
			}
		}
		assert.doesNotMatch(output, /module\.(beforeLoad|contentStart|afterLoad|go|onToggle)\s*=/);
	}
});

test('host metadata extraction removes media handlers and their heavy imports', () => {
	const source = `
		/* @flow */
		import { markdown } from 'snudown-js';
		import { Host } from '../../core/host';
		const host = new Host('sampleHost', {
			name: 'sample',
			domains: ['example.com'],
			options: { token: { title: 'tokenTitle', type: 'text', value: '' } },
			detect: () => true,
			handleLink: href => ({ type: 'TEXT', src: markdown(href) }),
		});
		export default host;
	`;

	const output = extractHostMetadata(source, 'sampleHost.js');
	assert.match(output, /new Host\(['"]sampleHost['"]/);
	assert.match(output, /domains: \[['"]example\.com['"]\]/);
	assert.match(output, /options:/);
	assert.doesNotMatch(output, /snudown-js|markdown\(/);
	assert.match(output, /detect\(\)\s*\{\s*return null/);
});

test('options page loads the isolated Markdown renderer before its application bundle', () => {
	const html = fs.readFileSync(path.join(root, 'lib/options/options.html'), 'utf8');
	assert.ok(html.indexOf('snudown.entry.js') < html.indexOf('options.entry.js'));
	const settings = fs.readFileSync(path.join(root, 'lib/options/settingsConsole.js'), 'utf8');
	assert.doesNotMatch(settings, /from ['"]snudown-js['"]/);
});
