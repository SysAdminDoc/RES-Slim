#!/usr/bin/env node

// @noflow


import path from 'node:path';
import process from 'node:process';
import { importFixtureFile } from './fixture-sanitizer.mjs';

function usage(message) {
	if (message) console.error(message);
	console.error('Usage: node scripts/import-old-reddit-fixture.mjs <capture.html> --kind frontpage|thread [--output path] [--captured-at ISO-8601]');
	process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) usage();

const inputPath = path.resolve(args[0]);
let kind;
let outputPath;
let capturedAt = new Date().toISOString();
const options = args.slice(1);
while (options.length) {
	const flag = options.shift();
	const value = options.shift();
	if (!value) usage(`Missing value for ${flag}`);
	if (flag === '--kind') kind = value;
	else if (flag === '--output') outputPath = path.resolve(value);
	else if (flag === '--captured-at') capturedAt = value;
	else usage(`Unknown option: ${flag}`);
}

if (!['frontpage', 'thread'].includes(kind)) usage('--kind must be frontpage or thread');
if (Number.isNaN(Date.parse(capturedAt))) usage('--captured-at must be a valid date');
const destination = outputPath || path.resolve('tests', 'fixtures', 'mhtml', `${kind}.html`);
const result = importFixtureFile(inputPath, destination, { kind, capturedAt: new Date(capturedAt).toISOString() });
console.log(`Wrote ${result.kind} structural fixture to ${destination}`);
