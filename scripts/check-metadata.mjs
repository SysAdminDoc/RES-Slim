#!/usr/bin/env node
// `yarn check:metadata` — does GitHub still describe this repo the way the README
// does?
//
// Why this exists: `docs-drift-contract` asserts the README does not call this a
// "private fork". The GitHub repo description said exactly that for months
// anyway, and that description is the copy the public actually reads — the
// README is the second thing anyone sees. This is the third instance of the same
// class in this repo: a contract bound to one copy of a duplicated fact while the
// other copies drift freely. The Chrome manifest floor and the Toolbox-NXG
// search-as-existence-proof were the first two.
//
// Reports, never fails. It needs the network and a `gh` login, and neither is a
// property of the code — a gate that goes red because someone is offline stops
// being read.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

// Phrases the README rules out. Each one is a claim the description could make
// that the README has already decided is wrong.
const FORBIDDEN = [
	{ pattern: /\bprivate fork\b/i, why: 'the repo is public; the README calls it a personal fork, not a private one' },
	{ pattern: /\bnew\.reddit\b/i, why: 'this targets old.reddit.com only' },
];

function note(message) { console.log(`  ${message}`); }

// One command string, not a command plus args. `gh` needs a shell on Windows,
// and with `shell: true` an args array is concatenated unquoted — which splits
// the jq expression on its spaces and hands gh four arguments where it wanted
// one. Same reason `scripts/verify.mjs` spawns a single string.
function gh(command) {
	const result = spawnSync(`gh ${command}`, { cwd: repoRoot, encoding: 'utf8', shell: true });
	if (result.status !== 0) return null;
	return (result.stdout || '').trim();
}

const slug = (() => {
	const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.homepage || pkg.repository?.url || '');
	return match ? match[1] : null;
})();

console.log('metadata: comparing the GitHub repo description and topics against README.md');

if (!slug) {
	note('could not work out the GitHub slug from package.json — nothing to compare.');
	process.exit(0);
}

const raw = gh(`api repos/${slug} --jq "{description: .description, topics: .topics}"`);
if (!raw) {
	note('gh could not read the repo (offline, or not logged in). Skipping — this check never fails a build.');
	process.exit(0);
}

let meta;
try {
	meta = JSON.parse(raw);
} catch (e) {
	note(`gh returned something unparseable: ${raw.slice(0, 120)}`);
	process.exit(0);
}

const findings = [];
const description = meta.description || '';

if (!description) {
	findings.push('the repo has no description at all — the first line anyone reads is blank');
} else {
	for (const { pattern, why } of FORBIDDEN) {
		if (pattern.test(description)) findings.push(`description matches ${pattern} — ${why}`);
	}
}

const topics = Array.isArray(meta.topics) ? meta.topics : [];
if (!topics.length) {
	findings.push('no topics are set, so the repo does not appear in any topic listing');
}

// The README's opening sentence is the canonical framing. Not compared word for
// word — a description is shorter by design — but the load-bearing nouns should
// survive into it.
const KEY_TERMS = ['old.reddit', 'fork'];
for (const term of KEY_TERMS) {
	if (readme.toLowerCase().includes(term) && !description.toLowerCase().includes(term)) {
		findings.push(`description does not mention "${term}", which the README treats as central`);
	}
}

if (!findings.length) {
	console.log('  ok — the published description and topics match how the README describes this repo.');
	process.exit(0);
}

console.log(`\n  description: ${description || '(none)'}`);
console.log(`  topics: ${topics.length ? topics.join(', ') : '(none)'}\n`);
for (const finding of findings) note(`drift: ${finding}`);
console.log('\n  Fix with `gh repo edit --description "..."` / `gh repo edit --add-topic ...`.');
console.log('  Reported, not failed: this needs the network and a gh login, neither of which is a property of the code.');
process.exit(0);
