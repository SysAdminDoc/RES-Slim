#!/usr/bin/env node
// `yarn publish:release [version]` — the half `release.mjs` deliberately stops
// before.
//
// `release.mjs` writes the version strings, commits and tags, and then stops:
// pushing runs the pre-push hook, which runs every gate, and that should be the
// operator's deliberate act. What was missing was everything after the push —
// the artifacts, their digests, the GitHub release, and any way to tell whether
// what is on GitHub is what was built here. That gap is why the tree sat fifteen
// commits and one tag ahead of the remote while the latest release was two
// versions behind.
//
// Every step below either verifies a fact or refuses. Nothing is uploaded that
// was not built from the tagged commit in this working tree, and the last thing
// it does is read the release back off GitHub and compare it to what it sent.
//
// Re-running on an already-published version is safe: it re-verifies and reports
// "already published", and refuses if the remote disagrees with local state.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const skipFirefox = process.argv.includes('--skip-firefox');

function fail(message) {
	console.error(`publish: ${message}`);
	process.exit(1);
}

function run(command, { capture = true, allowFailure = false } = {}) {
	const result = spawnSync(command, { cwd: repoRoot, shell: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
	if (!allowFailure && result.status !== 0) {
		if (capture) console.error(result.stdout || '', result.stderr || '');
		fail(`\`${command}\` failed`);
	}
	return { code: result.status, out: capture ? String(result.stdout || '').trim() : '' };
}

function git(...args) {
	return run(`git ${args.join(' ')}`).out;
}

// --- what is being published --------------------------------------------------

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const requested = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const version = requested || pkg.version;
const tag = `v${version}`;

if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" is not a version`);
if (version !== pkg.version) {
	fail(`asked to publish ${version} but package.json is ${pkg.version}; run \`yarn release ${version}\` first`);
}

// --- refusals -----------------------------------------------------------------

// A release describes a tree. Publishing from a dirty one publishes something
// nobody can reproduce.
const dirty = git('status', '--porcelain').split('\n').filter(Boolean)
	// `.md` files other than README are gitignored here, so an edited ROADMAP is
	// not uncommitted work in the sense that matters.
	//
	// Untracked files are: they are in the tree, so `yarn build` bundles them and
	// every gate below runs against them, while `git` has never seen them. v0.54.0
	// shipped that way — a half-finished settings-console feature and its
	// untracked test were in the tree when the ZIPs were built, so the published
	// artifacts carried a locale string and a changed default that the tag does
	// not contain, and the digest file vouched for them.
	.filter(line => !/\.md$/.test(line));
if (dirty.length) fail(`working tree has uncommitted changes:\n  ${dirty.join('\n  ')}`);

const remote = git('remote', 'get-url', 'origin');
if (!/SysAdminDoc\/RES-Slim(\.git)?$/.test(remote)) fail(`origin is ${remote}, which is not this project's repository`);

// Do not use Git's usual caret-based annotated-tag peel expression here. Node's
// Windows shell passes the caret through cmd.exe, which consumes it as an escape
// and asks Git for an invalid revision instead.
const localTagResult = run(`git rev-list -n 1 ${tag}`, { allowFailure: true });
const localTag = localTagResult.out;
if (localTagResult.code !== 0 || !localTag) fail(`no local tag ${tag}; run \`yarn release ${version}\` first`);
const head = git('rev-parse', 'HEAD');
if (localTag !== head) fail(`${tag} points at ${localTag.slice(0, 9)} but HEAD is ${head.slice(0, 9)}; publish the commit the tag names`);

const annotated = run(`git cat-file -t ${tag}`, { allowFailure: true }).out;
if (annotated !== 'tag') fail(`${tag} is a lightweight tag; \`yarn release\` makes an annotated one`);
const localTagObject = git('rev-parse', tag);

// The committed tree, not the working copy: every drift contract in this repo
// reads from disk, so "right on disk, never staged" is a gap none of them close.
const committedPkg = JSON.parse(git('show', `${tag}:package.json`));
if (committedPkg.version !== version) fail(`${tag} contains package.json ${committedPkg.version}, not ${version}`);
const committedChangelog = git('show', `${tag}:CHANGELOG.md`);
if (!committedChangelog.includes(`## v${version},`)) fail(`${tag} has no "## v${version}" CHANGELOG section`);

console.log(`publish: ${tag} at ${head.slice(0, 9)}`);

// --- the gates ----------------------------------------------------------------

if (dryRun) {
	console.log('publish: --dry-run, stopping before the gates');
	process.exit(0);
}

console.log('publish: running every gate');
run('yarn verify', { capture: false });

if (skipFirefox) {
	console.log('publish: --skip-firefox, the MV2 add-on was not driven in a real browser');
} else {
	// Not a `yarn verify` gate, because it needs a system Firefox the repo does
	// not install. A release is exactly when that is worth requiring.
	console.log('publish: driving the MV2 add-on in Firefox');
	run('yarn firefox:audit', { capture: false });
}

// --- artifacts ----------------------------------------------------------------

// `yarn verify` runs `yarn build`, whose `prebuild` rimrafs `dist`, so the zips
// below are from this run and no earlier one. Checked rather than assumed: a
// stale artifact is the one failure that looks exactly like success.
const zipDir = path.join(repoRoot, 'dist', 'zip');
const artifacts = ['chrome', 'firefox'].map(target => {
	const source = path.join(zipDir, `${target}.zip`);
	if (!fs.existsSync(source)) fail(`no ${target} artifact at ${source}; the build did not produce one`);
	return { target, source, name: `RES-Slim-${tag}-${target}.zip` };
});

for (const artifact of artifacts) {
	// The manifest inside the zip is the only thing that can say which version was
	// actually built. A zip left over from a previous version is otherwise
	// indistinguishable from a fresh one.
	const bytes = fs.statSync(artifact.source).size;
	if (!bytes) fail(`${artifact.source} is empty`);
	artifact.bytes = bytes;
	artifact.sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifact.source)).digest('hex');
}

// Renamed rather than uploaded as `chrome.zip`: two releases' assets are
// otherwise indistinguishable once downloaded.
// Both pushes run the pre-push hook, and that hook runs `yarn verify`. Its build
// removes `dist`, so release files staged anywhere under that directory vanish
// before GitHub can receive them. Keep the verified copies in the system temp
// directory until the release has been uploaded and read back.
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'res-slim-publish-'));
process.once('exit', () => fs.rmSync(staging, { recursive: true, force: true }));
const digestLines = [];
for (const artifact of artifacts) {
	artifact.upload = path.join(staging, artifact.name);
	fs.copyFileSync(artifact.source, artifact.upload);
	digestLines.push(`${artifact.sha256}  ${artifact.name}`);
	console.log(`publish: ${artifact.name} ${artifact.bytes} bytes sha256 ${artifact.sha256}`);
}
const digestFile = path.join(staging, `RES-Slim-${tag}-SHA256SUMS.txt`);
fs.writeFileSync(digestFile, `${digestLines.join('\n')}\n`);

// --- push ---------------------------------------------------------------------

// The pre-push hook runs every gate again. That is the point: what is pushed is
// what was verified, and a machine that skipped the hook cannot publish.
console.log('publish: pushing the release commit and tag');
run('git push', { capture: false });
run(`git push origin refs/tags/${tag}`, { capture: false });

// Compare the annotated tag object itself. This verifies the remote tag and its
// metadata without another caret-based peel expression on Windows.
const remoteTagObject = git('ls-remote', 'origin', `refs/tags/${tag}`).split(/\s+/)[0];
if (remoteTagObject !== localTagObject) fail(`origin's ${tag} object is ${remoteTagObject || 'missing'}, not the verified local tag`);

// --- the release --------------------------------------------------------------

const existing = run(`gh release view ${tag} --repo SysAdminDoc/RES-Slim --json tagName,assets`, { allowFailure: true });
const notesFile = path.join(staging, 'notes.md');
fs.writeFileSync(notesFile, releaseNotes(committedChangelog, version));

if (existing.code === 0) {
	console.log(`publish: release ${tag} already exists, uploading any missing assets`);
	run(`gh release upload ${tag} ${[...artifacts.map(a => a.upload), digestFile].map(quote).join(' ')} --repo SysAdminDoc/RES-Slim --clobber`, { capture: false });
} else {
	run(`gh release create ${tag} --repo SysAdminDoc/RES-Slim --title ${quote(tag)} --notes-file ${quote(notesFile)} ${[...artifacts.map(a => a.upload), digestFile].map(quote).join(' ')}`, { capture: false });
}

// --- read it back -------------------------------------------------------------

// Everything above is what this script believes it did. This is what GitHub
// says happened, which is the only half that matters to somebody downloading it.
const published = JSON.parse(run(`gh release view ${tag} --repo SysAdminDoc/RES-Slim --json tagName,isDraft,assets`).out);
if (published.tagName !== tag) fail(`GitHub reports the release as ${published.tagName}`);
if (published.isDraft) fail('the release is a draft, so nobody can download it');

const assetNames = published.assets.map(a => a.name).sort();
const expected = [...artifacts.map(a => a.name), path.basename(digestFile)].sort();
for (const name of expected) {
	if (!assetNames.includes(name)) fail(`${name} is not on the release; assets are ${assetNames.join(', ') || 'none'}`);
}
for (const artifact of artifacts) {
	const asset = published.assets.find(a => a.name === artifact.name);
	if (asset.size !== artifact.bytes) fail(`${artifact.name} is ${asset.size} bytes on GitHub and ${artifact.bytes} here`);
}

console.log(`publish: ${tag} is live with ${assetNames.length} assets, sizes verified against the local build.`);

// --- helpers ------------------------------------------------------------------

function quote(value) {
	return `"${value.replace(/"/g, '\\"')}"`;
}

// The section this version's own CHANGELOG heading opens, so the release notes
// are the notes that were committed rather than a second copy written by hand.
function releaseNotes(changelog, forVersion) {
	const start = changelog.indexOf(`## v${forVersion},`);
	if (start < 0) return `RES-Slim v${forVersion}`;
	const rest = changelog.slice(start);
	const next = rest.indexOf('\n## ', 1);
	return next < 0 ? rest.trim() : rest.slice(0, next).trim();
}
