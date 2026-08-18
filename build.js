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

// Third-party libraries that ship as separate on-demand files rather than being
// bundled. Each is injected at the moment it is first needed (see
// `environment/foreground/loadScript`), so its weight is paid by the users who
// trigger the feature instead of by every page load. Because they are copied in
// verbatim rather than passing through esbuild, each carries a pinned digest:
// nothing else in the build would notice a tampered or silently-upgraded file.
const VENDORED_ASSETS = [
	{
		file: 'dash.mediaplayer.min.js',
		from: './node_modules/dashjs/dist/dash.mediaplayer.min.js',
		sha256: '66dff6f83ec1e22418f3fa17a2b2b9b21b7b3ffc290fd17a6a6595678c35ed9b',
	},
	{
		file: 'jszip.min.js',
		from: './node_modules/jszip/dist/jszip.min.js',
		sha256: 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e',
	},
];

// The supported floor has exactly one source: `browserslist` in package.json.
//
// It used to be declared twice — hardcoded here, and in a `browserslist` field
// that nothing read — and the two disagreed (chrome 114/firefox 115 here against
// chrome 114/firefox 119 there). Since this copy is what actually reaches
// esbuild's `target` and the Firefox manifest's `strict_min_version`, the
// package.json values were decoration, and any support claim based on them was
// unverified. `browsersMinVersions()` reads them, so a change in one place cannot
// leave the other behind.
function browserMinVersions() {
	const parsed = {};
	for (const entry of packageInfo.browserslist) {
		const [name, version] = String(entry).trim().split(/\s+/);
		if (!name || !version) throw new Error(`Unparseable browserslist entry: "${entry}"`);
		parsed[name] = version.includes('.') ? version : `${version}.0`;
	}
	for (const required of ['chrome', 'firefox']) {
		if (!parsed[required]) throw new Error(`browserslist in package.json must declare a "${required}" floor`);
	}
	return parsed;
}

const minVersions = browserMinVersions();

const targets = {
	chrome: {
		browserName: 'chrome',
		browserMinVersion: minVersions.chrome,
		manifest: './chrome/manifest.json',
	},
	firefox: {
		browserName: 'firefox',
		browserMinVersion: minVersions.firefox,
		manifest: './firefox/manifest.json',
	},
}

const validModes = new Set(['development', 'production']);

// Targets build concurrently and the bundle baseline is one shared file, so a
// read-modify-write per target races: the second writer overwrites the first
// target's entry with a copy it read before that entry existed. Chaining the
// updates makes each one read what the previous actually wrote.
let bundleBaselineQueue = Promise.resolve();
function queueBundleBaselineUpdate(update) {
	const next = bundleBaselineQueue.then(update);
	bundleBaselineQueue = next.catch(() => {});
	return next;
}

const options = commander.program
	.option('--watch', 'Enable watch mode')
	.option('--zip', 'Enable zipping')
	.option('--mode <type>', 'Set the mode', 'development')
	.option('--browsers <list>', 'Specify browsers to target', 'chrome')
	.option('--update-bundle-baseline', 'Rewrite the recorded bundle sizes instead of asserting against them')
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

async function buildForBrowser(targetName, { manifest, browserName, browserMinVersion }) {
	const context = {
		entryPoints: {
			'foreground.entry': './lib/foreground.entry.js',
			'background.entry': './lib/background.entry.js',
			'options.entry': './lib/options/options.entry.js',
			'prompt.entry': './lib/environment/background/permissions/prompt.entry.js',
			manifest,
			options: './lib/options/options.scss',
			res: './lib/css/res.scss',
			prompt: './lib/environment/background/permissions/prompt.scss',
		},
		// Dev keeps sourcemaps; production never emits them for either target.
		// This used to be `!isProduction || !noSourcemap`, which is true for any
		// target that does not set noSourcemap — i.e. Chrome — so the production
		// Chrome zip shipped .map files carrying the full original sources and came
		// out at more than double the Firefox one.
		sourcemap: !isProduction,
		// Production minifies; development never does, so a stack trace in the
		// browser still points at readable source. This was simply never set, so
		// every release shipped the foreground content script — parsed at
		// document_start on every Reddit page — as full-width readable source.
		minify: isProduction,
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
					{ from: ['./rules/ad-block.json'], to: ['./'] },
					{ from: ['./images/css-off-small.png'], to: ['./'] },
					{ from: ['./images/css-off.png'], to: ['./'] },
					{ from: ['./images/css-on-small.png'], to: ['./'] },
					{ from: ['./images/css-on.png'], to: ['./'] },
					{ from: ['./images/icon128.png'], to: ['./'] },
					{ from: ['./images/icon48.png'], to: ['./'] },
					{ from: ['./lib/environment/background/permissions/prompt.html'], to: ['./'] },
					{ from: ['./lib/options/options.html'], to: ['./'] },
					...VENDORED_ASSETS.map(({ from }) => ({ from: [from], to: ['./'] })),
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
			},
			isProduction ? {
				name: 'bundle-baseline',
				setup(build) {
					build.onEnd(async () => {
						// A ratchet, not a ceiling. The budgets this replaced sat ~400KB
						// above reality, so no realistic regression could trip them — the
						// foreground entry could have grown by a third and still passed.
						// Recorded sizes fail in both directions, like the eslint and flow
						// baselines: growth is a regression, and a shrink is a win worth
						// banking rather than silently losing.
						const TRACKED = [
							'foreground.entry.js',
							'options.entry.js',
							'background.entry.js',
							'res.css',
							'options.css',
							...VENDORED_ASSETS.map(({ file }) => file),
						];
						// Byte-exact would be too brittle: an esbuild patch release moves
						// output by a few bytes. 2% of the foreground entry is ~16KB, far
						// tighter than the 400KB of slack it replaces.
						const TOLERANCE = 0.02;
						const baselinePath = './tests/fixtures/lint/bundle-baseline.json';

						const sizes = {};
						const missing = [];
						const stats = await Promise.all(TRACKED.map(file =>
							fs.promises.stat(`./dist/${targetName}/${file}`).catch(() => null)));
						for (const [i, stat] of stats.entries()) {
							const file = TRACKED[i];
							// A check that skips missing files passes for a build that never
							// produced them, which is the failure it exists to catch.
							if (!stat) missing.push(`${file}: missing from the build output`);
							else sizes[file] = stat.size;
						}

						const readBaseline = () => fs.promises.readFile(baselinePath, 'utf8')
							.then(JSON.parse)
							.catch(() => ({}));

						if (options.updateBundleBaseline) {
							if (missing.length) {
								throw new Error(`Refusing to record a baseline from an incomplete build:\n  ${missing.join('\n  ')}`);
							}
							await queueBundleBaselineUpdate(async () => {
								// Re-read inside the queue: another target may have written
								// its own entry since this build started.
								const baseline = await readBaseline();
								baseline[targetName] = sizes;
								const ordered = Object.fromEntries(Object.keys(baseline).sort().map(k => [k, baseline[k]]));
								await fs.promises.writeFile(baselinePath, `${JSON.stringify(ordered, null, '\t')}\n`);
							});
							console.log(`recorded bundle baseline for ${targetName}`);
							return;
						}

						const recorded = (await readBaseline())[targetName];
						if (!recorded) {
							throw new Error(`No bundle baseline recorded for ${targetName}. Run \`yarn bundle:baseline\`.`);
						}

						const violations = [...missing];
						for (const [file, size] of Object.entries(sizes)) {
							const was = recorded[file];
							if (typeof was !== 'number') {
								violations.push(`${file}: not in the baseline — run \`yarn bundle:baseline\``);
								continue;
							}
							const delta = (size - was) / was;
							if (Math.abs(delta) <= TOLERANCE) continue;
							const direction = delta > 0 ? 'grew' : 'shrank';
							violations.push(`${file}: ${direction} ${(Math.abs(delta) * 100).toFixed(1)}% (${was} -> ${size} bytes)`);
						}
						for (const file of Object.keys(recorded)) {
							if (!Object.hasOwn(sizes, file) && !missing.some(m => m.startsWith(`${file}:`))) {
								violations.push(`${file}: in the baseline but not in the build output`);
							}
						}

						if (violations.length) {
							throw new Error(`Bundle sizes moved away from the baseline:\n  ${violations.join('\n  ')}\n\nIf you caused this and it is expected, bank it:\n  yarn bundle:baseline`);
						}
					});
				},
			} : undefined,
			{
				// A vendored library exists precisely so it is *not* in a bundle. Nothing
				// enforced that: `galleryZip` wrote `await import('jszip')`, which reads as
				// lazy but is not, because `format: 'iife'` with no splitting leaves esbuild
				// no choice but to inline it — 153KB in the content script parsed on every
				// Reddit page for a module disabled by default. The size ratchet could not
				// catch it either, since it was in the baseline from the start. This asserts
				// the property directly, against the metafile esbuild just produced.
				name: 'verify-vendored-not-bundled',
				setup(build) {
					build.onEnd(result => {
						if (!result.metafile) return;
						const packages = VENDORED_ASSETS.map(({ from }) => from.replace('./node_modules/', '').split('/')[0]);
						const violations = [];
						for (const [outFile, output] of Object.entries(result.metafile.outputs)) {
							if (!outFile.endsWith('.entry.js')) continue;
							for (const input of Object.keys(output.inputs || {})) {
								const pkg = packages.find(name => input.includes(`node_modules/${name}/`));
								if (pkg) violations.push(`${pkg} is bundled into ${path.basename(outFile)} (via ${input})`);
							}
						}
						if (violations.length) {
							throw new Error(`Vendored on-demand libraries must not be bundled:\n  ${violations.join('\n  ')}\n\nLoad it with loadScript('/<file>') instead of importing it — a dynamic import() is inlined by this build, not split.`);
						}
					});
				},
			},
			{
				name: 'verify-vendored-integrity',
				setup(build) {
					build.onEnd(async () => {
						await Promise.all(VENDORED_ASSETS.map(async ({ file, sha256 }) => {
							const content = await fs.promises.readFile(`./dist/${targetName}/${file}`);
							const actual = crypto.createHash('sha256').update(content).digest('hex');
							if (actual !== sha256) {
								throw new Error(`${file} integrity check failed!\n  expected: ${sha256}\n  actual:   ${actual}\nThe vendored file may have been tampered with. Update its entry in VENDORED_ASSETS in build.js if you intentionally upgraded the package.`);
							}
						}));
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

		// Only reached when every onEnd gate passed — esbuild.build() rejects
		// otherwise — so a build that blew its bundle budget or failed a vendored
		// integrity check leaves no shippable zip behind.
		if (options.zip) {
			const zip = new JSZip();
			await addDirectoryToZip(zip, `./dist/${targetName}/`);
			const zipContent = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' });
			await fs.promises.mkdir('./dist/zip', { recursive: true });
			await fs.promises.writeFile(`./dist/zip/${targetName}.zip`, zipContent);
			console.log(`emitted zip file for ${targetName}`);
		}
	}
}

const buildTargets = normalizeBuildTargets(options.browsers);
await Promise.all(buildTargets.map(v => buildForBrowser(v, targets[v])));
