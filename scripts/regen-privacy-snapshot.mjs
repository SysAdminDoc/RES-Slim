// One-shot helper: regenerate tests/fixtures/privacy/outbound-url-snapshot.json
// from current lib/ source. Run from repo root: `node scripts/regen-privacy-snapshot.mjs`
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('.');
const libRoot = path.join(repoRoot, 'lib');
const snapshotPath = path.join(repoRoot, 'tests', 'fixtures', 'privacy', 'outbound-url-snapshot.json');
const urlPattern = /https?:\/\/[^\s'"`<>)\\]+/gu;

function listJavaScriptFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) return listJavaScriptFiles(fullPath);
		return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
	});
}

const entries = listJavaScriptFiles(libRoot).flatMap(file => {
	const relativePath = path.relative(repoRoot, file).replace(/\\/g, '/');
	const source = fs.readFileSync(file, 'utf8');
	return [...source.matchAll(urlPattern)].map(match => ({
		file: relativePath,
		url: match[0],
	}));
}).sort((a, b) => a.file.localeCompare(b.file) || a.url.localeCompare(b.url));

const existing = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
existing.entries = entries;
fs.writeFileSync(snapshotPath, JSON.stringify(existing, null, 2) + '\n');
console.log(`wrote ${entries.length} entries`);
