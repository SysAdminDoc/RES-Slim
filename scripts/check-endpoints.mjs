// Runs the endpoint list against the network and gates the build.
//
//   yarn check:endpoints
//
// The list itself lives in `endpoint-list.mjs` and the single-request logic in
// `endpoint-probe.mjs`, both so a contract can read and drive them. A test that
// regexes this file for its entries can be evaded by a comment or a reformat,
// which is exactly how the first version of that contract passed with a host
// silently unprobed.

import process from 'node:process';

import { withTransportRetries } from './endpoint-retry.mjs';
import { probeEndpoint } from './endpoint-probe.mjs';
import { FETCHED, LINKED } from './endpoint-list.mjs';

const TIMEOUT_MS = 15000;

function probeAttempt(entry) {
	return probeEndpoint(entry, { fetch, timeoutMs: TIMEOUT_MS });
}

function probeOne(entry) {
	return withTransportRetries(() => probeAttempt(entry));
}

// A group stands in for one ordered setting: the feature works if any member
// answers, so the group's verdict is the disjunction of its members'.
async function probe(entry) {
	if (!entry.anyOf) return probeOne(entry);
	const members = await Promise.all(entry.anyOf.map(probeOne));
	return { name: entry.name, members, ok: members.some(m => m.ok) };
}

function report(results) {
	for (const r of results) {
		if (r.members) {
			const alive = r.members.filter(m => m.ok).length;
			console.log(`[${r.ok ? 'ok  ' : 'FAIL'}]      ${r.name} (${alive}/${r.members.length} alive)`);
			for (const m of r.members) {
				const retryDetail = m.attempts > 1 ? ` after ${m.attempts} attempts` : '';
				const detail = m.error ? ` (${m.error}; ${m.attempts} attempts)` : retryDetail;
				console.log(`         ${m.ok ? ' ok ' : 'FAIL'} ${String(m.status).padStart(3)}  ${m.name}${detail}`);
				console.log(`                   ${m.url}`);
			}
			continue;
		}
		const retryDetail = r.attempts > 1 ? ` after ${r.attempts} attempts` : '';
		const detail = r.error ? ` (${r.error}; ${r.attempts} attempts)` : retryDetail;
		console.log(`[${r.ok ? 'ok  ' : 'FAIL'}] ${String(r.status).padStart(3)}  ${r.name}${detail}`);
		console.log(`            ${r.url}`);
	}
}

const [fetched, linked] = await Promise.all([
	Promise.all(FETCHED.map(probe)),
	Promise.all(LINKED.map(probe)),
]);

console.log('Fetched by the extension (these gate the build):');
report(fetched);
console.log('');
console.log('Linked for the user to click (reported only — bot protection here is not a failure):');
report(linked);
console.log('');

const failures = fetched.filter(r => !r.ok);
const linkedFailures = linked.filter(r => !r.ok);
if (linkedFailures.length) {
	console.log(`${linkedFailures.length} linked host(s) refused a scripted probe. Confirm in a browser before changing anything.`);
}

if (failures.length) {
	console.log(`${failures.length} of ${fetched.length} fetched endpoints failed.`);
	console.log('A failing host means the module that ships it is broken out of the box.');
	console.log('Replace the default with a probed, live host — do not just remove the check.');
	process.exit(1);
}
console.log(`All ${fetched.length} fetched endpoints responded.`);
