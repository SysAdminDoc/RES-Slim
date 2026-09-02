import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readRepoFile, repoRoot } from './helpers/loadFlowModule.mjs';

// `release.mjs` writes the version strings, commits and tags, and stops. What
// was missing was everything after that — the artifacts, their digests, the
// GitHub release, and any way to tell whether what is on GitHub is what was
// built here. The repo sat fifteen commits and one tag ahead of the remote for
// weeks while the latest release was two versions behind, and nothing could
// report it.
//
// A publisher cannot be exercised end to end from a unit test: the real thing
// pushes, uploads, and creates a release that cannot be taken back. What it
// *can* be held to is that every refusal is a refusal, and that it verifies the
// result rather than trusting its own log.

const source = readRepoFile('scripts/publish.mjs');

function publish(args, env = {}) {
	return spawnSync(`node scripts/publish.mjs ${args}`, {
		cwd: repoRoot,
		shell: true,
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
}

test('publish:release is wired up and reachable', () => {
	const pkg = JSON.parse(readRepoFile('package.json'));
	assert.equal(pkg.scripts['publish:release'], 'node scripts/publish.mjs');
	assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'publish.mjs')));
});

test('a version that is not the one in package.json is refused before anything happens', () => {
	// Publishing a version the tree does not claim to be is how a tag ends up
	// naming a build of something else.
	const result = publish('9.9.9 --dry-run');
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /asked to publish 9\.9\.9 but package\.json is/);
});

test('a version that is not a version is refused', () => {
	const result = publish('not-a-version --dry-run');
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /is not a version/);
});

test('every refusal named in the acceptance is actually implemented', () => {
	// Each of these is a way to publish something nobody can reproduce, and each
	// one has been a real failure in some project. Checked as source shape,
	// because the alternative is a test that pushes.
	const refusals = [
		[/working tree has uncommitted changes/, 'a dirty tree describes a build nobody can reproduce'],
		[/is not this project's repository/, 'the wrong remote publishes to somebody else'],
		[/yarn verify/, 'the full gate chain has to run, not a subset'],
		[/yarn firefox:audit/, 'the MV2 add-on is driven in a real browser before a release'],
		[/points at .* but HEAD is/, 'the tag has to name the commit being published'],
		[/lightweight tag/, 'an annotated tag is what release.mjs makes'],
		[/contains package\.json .*, not/, 'the tagged tree has to carry the version'],
		[/has no ".*CHANGELOG section/, 'a release with no notes in the tag is undocumented'],
		[/the build did not produce one/, 'a missing artifact must not be published as an empty release'],
	];
	for (const [pattern, why] of refusals) {
		assert.match(source, pattern, why);
	}
});

test('the artifacts are hashed, renamed, and their digests shipped', () => {
	assert.match(source, /createHash\('sha256'\)/, 'a download nobody can verify is a download nobody should trust');
	assert.match(source, /RES-Slim-\$\{tag\}-\$\{target\}\.zip/, 'two releases\' assets are indistinguishable once downloaded under a generic name');
	assert.match(source, /SHA256SUMS\.txt/, 'the digests have to be published beside what they describe');
	assert.match(source, /fs\.statSync\(artifact\.source\)\.size/, 'artifact size checks must not quote Windows paths through a child shell');
	assert.doesNotMatch(source, /node -e .*readFileSync/, 'cmd.exe breaks nested quotes around absolute Windows paths');
	assert.match(source, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'res-slim-publish-'\)\)/, 'pre-push verification removes dist before GitHub receives staged files');
	assert.doesNotMatch(source, /const staging = path\.join\(repoRoot, 'dist'/, 'release staging must survive the pre-push build');
	// `dist/zip` is produced by `yarn build`, whose `prebuild` rimrafs `dist` —
	// so the artifacts are from this run. Stated in the script, because a stale
	// artifact is the one failure that looks exactly like success.
	assert.match(source, /rimrafs `dist`/);
});

test('the result is read back off GitHub rather than assumed', () => {
	// Everything before this is what the script believes it did. This is the only
	// half that matters to somebody downloading it.
	assert.match(source, /gh release view \$\{tag\}/, 'the release has to be read back');
	assert.match(source, /isDraft/, 'a draft release is one nobody can download');
	assert.match(source, /asset\.size !== artifact\.bytes/, 'an asset that is the wrong size did not upload cleanly');
	assert.match(source, /ls-remote/, 'the remote tag has to be confirmed, not assumed from a push exit code');
});

test('annotated tag checks survive Windows command parsing', () => {
	assert.doesNotMatch(source, /\^\{(?:commit)?\}/, 'cmd.exe consumes the caret before Git can peel the tag');
	assert.match(source, /git rev-list -n 1 \$\{tag\}/, 'the local tag still has to resolve to the release commit');
	assert.match(source, /remoteTagObject !== localTagObject/, 'the remote must carry the exact annotated tag object');
});

test('re-running an already published version is safe rather than a second release', () => {
	assert.match(source, /already exists, uploading any missing assets/);
	assert.match(source, /--clobber/, 'a partial upload has to be completable');
});

test('the release notes come from the committed CHANGELOG, not a second copy', () => {
	// A hand-written note is a second source of truth that drifts from the one
	// `docs-drift-contract` checks.
	assert.match(source, /function releaseNotes\(/);
	assert.match(source, /--notes-file/);
	assert.ok(!/--notes ["']/.test(source), 'inline notes are a second copy of the changelog');
});
