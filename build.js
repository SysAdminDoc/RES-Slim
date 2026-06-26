/* @noflow */
/* eslint import/no-nodejs-modules: 0, import/extensions: 0 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as commander from 'commander';
import * as esbuild from 'esbuild';
import * as semver from 'semver';
import JSZip from 'jszip';
import flowRemoveTypes from 'flow-remove-types';
import { copy } from 'esbuild-plugin-copy';
import { sassPlugin } from 'esbuild-sass-plugin';
import isBetaVersion from './build/isBetaVersion.js';
import packageInfo from './package.json' with { type: 'json' };

const DASHJS_SHA256 = '66dff6f83ec1e22418f3fa17a2b2b9b21b7b3ffc290fd17a6a6595678c35ed9b';

const targets = {
	chrome: {
		browserName: 'chrome',
		browserMinVersion: '114.0',
		manifest: './chrome/manifest.json',
	},
	firefox: {
		browserName: 'firefox',
		browserMinVersion: '115.0',
		manifest: './firefox/manifest.json',
		noSourcemap: true,
	},
}

const validModes = new Set(['development', 'production']);

const options = commander.program
	.option('--watch', 'Enable watch mode')
	.option('--zip', 'Enable zipping')
	.option('--mode <type>', 'Set the mode', 'development')
	.option('--browsers <list>', 'Specify browsers to target', 'chrome')
	.parse(process.argv)
	.opts();

if (!validModes.has(options.mode)) {
	throw new Error(`Unsupported build mode "${options.mode}". Expected one of: ${Array.from(validModes).join(', ')}`);
}

const isProduction = options.mode === 'production';
const devBuildToken = `${Math.random()}`.slice(2);
const name /*: string */ = packageInfo.title;
const author /*: string */ = packageInfo.author;
const description /*: string */ = packageInfo.description;
const version /*: string */ = packageInfo.version;
const isBeta /*: boolean */ = isBetaVersion(version);
const isPatch /*: boolean */ = semver.patch(version) !== 0;
const isMinor /*: boolean */ = !isPatch && semver.minor(version) !== 0;
const isMajor /*: boolean */ = !isPatch && !isMinor && semver.major(version) !== 0;
const updatedURL /*: string */ = `CHANGELOG.md#v${version}`;
const homepageURL /*: string */ = packageInfo.homepage;
// used for invalidating caches on each build (executed at build time)
// production builds uses version number to keep the build reproducible
const buildToken = isProduction ? version : devBuildToken;

function normalizeBuildTargets(browsers) {
	const requestedTargets = String(browsers || '')
		.split(',')
		.map(target => target.trim())
		.filter(Boolean)
		.flatMap(target => target === 'all' ? Object.keys(targets) : [target]);
	const buildTargets = [...new Set(requestedTargets)];
	const unknownTargets = buildTargets.filter(target => !targets[target]);

	if (!buildTargets.length) {
		throw new Error(`No browser targets requested. Expected one of: ${Object.keys(targets).join(', ')}, all`);
	}

	if (unknownTargets.length) {
		throw new Error(`Unknown browser target "${unknownTargets.join(', ')}". Expected one of: ${Object.keys(targets).join(', ')}, all`);
	}

	return buildTargets;
}

async function addDirectoryToZip(zip, sourceDir, currentDir = sourceDir) {
	const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

	await Promise.all(entries.map(async entry => {
		const entryPath = path.join(currentDir, entry.name);
		const zipPath = path.relative(sourceDir, entryPath).split(path.sep).join('/');

		if (entry.isDirectory()) {
			await addDirectoryToZip(zip, sourceDir, entryPath);
		} else if (entry.isFile()) {
			const content = await fs.promises.readFile(entryPath);
			zip.file(zipPath, content);
		}
	}));
}

async function buildForBrowser(targetName, { manifest, noSourcemap, browserName, browserMinVersion }) {
	const context = {
		entryPoints: {
			'foreground.entry': './lib/foreground.entry.js',
			'background.entry': './lib/background.entry.js',
			'options.entry': './lib/options/options.entry.js',
			'prompt.entry': './lib/environment/background/permissions/prompt.entry.js',
			manifest,
			options: './lib/options/options.scss',
			res: './lib/css/res.scss',
		},
		sourcemap: !isProduction || !noSourcemap,
		outdir: `./dist/${targetName}/`,
		bundle: true,
		format: 'iife',
		treeShaking: true,
		metafile: true,
		target: [`${browserName}${browserMinVersion}`],
		loader: {
			'.svg': 'dataurl',
			'.gif': 'dataurl',
			'.png': 'dataurl',
			'.woff': 'dataurl',
		},
		define: {
			'process.env.BUILD_TARGET': `"${browserName}"`,
			'process.env.NODE_ENV': `"${options.mode}"`,
			'process.env.buildToken': `"${buildToken}"`,
			'process.env.name': `"${name}"`,
			'process.env.author': `"${author}"`,
			'process.env.description': `"${description}"`,
			'process.env.version': `"${version}"`,
			'process.env.isBeta': `"${isBeta.toString()}"`,
			'process.env.isPatch': `"${isPatch.toString()}"`,
			'process.env.isMinor': `"${isMinor.toString()}"`,
			'process.env.isMajor': `"${isMajor.toString()}"`,
			'process.env.updatedURL': `"${updatedURL}"`,
			'process.env.homepageURL': `"${homepageURL}"`,
		},
		plugins: [
			{
				name: 'remove-flow-types',
				setup(build) {
					build.onLoad({ filter: /\.m?js$/ }, async args => {
						const text = await fs.promises.readFile(args.path, 'utf8')
						const contents = flowRemoveTypes(text, { pretty: true }).toString();
						return {
							contents,
							loader: 'js',
						}
					})
				},
			},
			sassPlugin(),
			copy({
				assets: [
					{ from: ['./LICENSE'], to: ['./'] },
					{ from: ['./images/css-off-small.png'], to: ['./'] },
					{ from: ['./images/css-off.png'], to: ['./'] },
					{ from: ['./images/css-on-small.png'], to: ['./'] },
					{ from: ['./images/css-on.png'], to: ['./'] },
					{ from: ['./images/icon128.png'], to: ['./'] },
					{ from: ['./images/icon48.png'], to: ['./'] },
					{ from: ['./lib/environment/background/permissions/prompt.html'], to: ['./'] },
					{ from: ['./lib/options/options.html'], to: ['./'] },
					{ from: ['./node_modules/dashjs/dist/dash.mediaplayer.min.js'], to: ['./'] },
				],
			}),
			{
				name: 'build-manifest',
				setup(build) {
					build.onLoad({ filter: /manifest\.json$/ }, async args => {
						let text = await fs.promises.readFile(args.path, 'utf8')
						const replace = {
							__version__: version,
							__name__: name,
							__description__: description,
							__homepage__: homepageURL,
							__author__: author,
							__browser_min_version__: browserMinVersion,
						}
						Object.keys(replace).forEach(v => {
							text = text.replaceAll(v, replace[v]);
						});
						JSON.parse(text); // Check if resulting JSON is valid
						return { contents: text, loader: 'copy' };
					});
				},
			}, options.zip ? {
				name: 'zip-build',
				setup(build) {
					const sourceDir = `./dist/${targetName}/`;
					const outPath = './dist/zip';
					build.onEnd(async () => {
						const zip = new JSZip();
						await addDirectoryToZip(zip, sourceDir);

						const zipContent = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
						await fs.promises.mkdir(outPath, { recursive: true })
						await fs.promises.writeFile(`${outPath}/${targetName}.zip`, zipContent);
						console.log(`emitted zip file for ${targetName}`);
					})
				},
			} : undefined,
			{
				name: 'verify-dashjs-integrity',
				setup(build) {
					build.onEnd(async () => {
						const dashjsPath = `./dist/${targetName}/dash.mediaplayer.min.js`;
						const content = await fs.promises.readFile(dashjsPath);
						const actual = crypto.createHash('sha256').update(content).digest('hex');
						if (actual !== DASHJS_SHA256) {
							throw new Error(`dashjs integrity check failed!\n  expected: ${DASHJS_SHA256}\n  actual:   ${actual}\nThe vendored dashjs file may have been tampered with. Update DASHJS_SHA256 in build.js if you intentionally upgraded the package.`);
						}
					});
				},
			},
		].filter(Boolean),
	};

	if (options.watch) {
		console.log(`Watching ${targetName}; break to exit`);
		const ctx = await esbuild.context(context);
		await ctx.watch();
	} else {
		console.log(`building ${targetName}`);
		const result = await esbuild.build(context)
		fs.writeFileSync(`dist/esbuild-meta-${targetName}.json`, JSON.stringify(result.metafile))
	}
}

const buildTargets = normalizeBuildTargets(options.browsers);
await Promise.all(buildTargets.map(v => buildForBrowser(v, targets[v])));
