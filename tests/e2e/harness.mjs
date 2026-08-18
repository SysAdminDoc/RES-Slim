// Real-browser harness: loads the built unpacked extension into Chromium and
// hands back a live context plus the extension's runtime id.
//
// Why this exists, and why it is not Chrome:
// Chrome stable (137+) silently ignores `--load-extension` — no error, no
// extension, and an empty target list that reads exactly like a broken build.
// That single fact is what parked this repo's integration tests for years and
// left two roadmap items filed as "requires live browser validation". Playwright's
// bundled Chromium still honours the flag, and `channel: 'chromium'` selects the
// build whose new headless mode loads extensions, so the whole suite runs
// headless with no display at all.
//
// Two rules the launch depends on:
//   - Extensions require a *persistent* context. `chromium.launch()` +
//     `newContext()` will never load one, however the args are spelled.
//   - Load `dist/chrome/`, never the repo's `chrome/`. The checked-in manifest is
//     a token template (`__version__`), which Chromium rejects outright.

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const distDir = path.join(repoRoot, 'dist', 'chrome');
export const screenshotDir = path.join(here, 'screenshots');

// Headed runs must land on the isolated virtual display, never a physical
// monitor. Headless is the default precisely so this is rarely needed.
const HEADED = process.env.RES_E2E_HEADED === '1';
const ISOLATION_SCRIPT = path.join(os.homedir(), '.claude', 'scripts', 'visual-isolation.ps1');

function isolatedDisplayOrigin() {
	// Returns [x, y] of the virtual display, or null when the tooling is absent —
	// in which case a headed run is refused rather than quietly opening a window
	// on the user's real screen.
	if (!fs.existsSync(ISOLATION_SCRIPT)) return null;
	try {
		const out = execFileSync('pwsh', ['-NoProfile', '-File', ISOLATION_SCRIPT, 'ensure'], {
			encoding: 'utf8',
			timeout: 120000,
		});
		const match = out.match(/\{[\s\S]*\}/);
		if (!match) return null;
		const bounds = JSON.parse(match[0]);
		const x = bounds.X ?? bounds.x ?? bounds.Left ?? bounds.left;
		const y = bounds.Y ?? bounds.y ?? bounds.Top ?? bounds.top;
		return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
	} catch (e) {
		return null;
	}
}

export function assertBuilt() {
	const manifestPath = path.join(distDir, 'manifest.json');
	if (!fs.existsSync(manifestPath)) {
		throw new Error(`No build at ${distDir}. Run \`yarn once\` (or \`yarn build\`) before \`yarn test:e2e\`.`);
	}
	return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

// Launches the browser with the extension loaded and resolves once its MV3
// service worker has actually registered. A context that opens but never
// registers a worker is a failed load, not a slow one, so this throws rather
// than letting later assertions fail somewhere less informative.
export async function launchWithExtension({ timeout = 30000 } = {}) {
	assertBuilt();

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'res-slim-e2e-'));
	const args = [
		`--disable-extensions-except=${distDir}`,
		`--load-extension=${distDir}`,
		// Every reddit navigation in this suite is already `page.route`-intercepted
		// and served from a local sanitized capture, so nothing here needs the
		// internet. That was true by convention, and convention is not a property:
		// one un-routed URL would silently start reaching a third party, and the
		// suite would go red for reasons that have nothing to do with the
		// extension — reddit being slow, an anti-automation block on a fresh
		// profile, someone's train wifi.
		//
		// This makes it structural. DNS for everything but localhost resolves to a
		// dead address, so an un-routed request fails fast and loudly instead of
		// working on a good day. Playwright's own interception happens above the
		// network stack and is unaffected, which is exactly the line being drawn:
		// intercepted is fine, outbound is not.
		'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
	];

	if (HEADED) {
		const origin = isolatedDisplayOrigin();
		if (!origin) {
			throw new Error('RES_E2E_HEADED=1 but the isolated virtual display is unavailable. Refusing to open a window on a physical monitor.');
		}
		args.push(`--window-position=${origin[0]},${origin[1]}`, '--window-size=1600,1000');
	}

	const context = await chromium.launchPersistentContext(userDataDir, {
		channel: 'chromium',
		headless: !HEADED,
		viewport: { width: 1440, height: 900 },
		args,
	});

	let [worker] = context.serviceWorkers();
	if (!worker) worker = await context.waitForEvent('serviceworker', { timeout });

	// The worker's own origin is the only authoritative source of the runtime id;
	// it is generated from the unpacked path, so it cannot be hardcoded.
	const extensionId = new URL(worker.url()).host;

	const dispose = async () => {
		await context.close();
		fs.rmSync(userDataDir, { recursive: true, force: true });
	};

	return { context, worker, extensionId, dispose };
}

export function extensionUrl(extensionId, resource) {
	return `chrome-extension://${extensionId}/${resource.replace(/^\//, '')}`;
}

export function saveScreenshotDir() {
	fs.mkdirSync(screenshotDir, { recursive: true });
	return screenshotDir;
}
