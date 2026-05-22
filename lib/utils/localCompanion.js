/* @flow */
// Pure helpers for the localCompanion module. Validates and normalises the
// localhost-only base URL, builds the documented request shapes, and parses
// the health-check response. Dependency-free for unit testing.

export type CompanionHealth = {|
	ok: boolean,
	version?: string,
	ytdlp?: boolean,
	ffmpeg?: boolean,
	ollama?: boolean,
|};

const LOCALHOST_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/.*)?$/i;

export function isLocalhostUrl(raw: mixed): boolean {
	return typeof raw === 'string' && LOCALHOST_RE.test(raw.trim());
}

export function sanitizeCompanionUrl(raw: mixed, fallback: string = 'http://127.0.0.1:7860'): string {
	if (typeof raw !== 'string' || !raw.trim()) return fallback;
	let v = raw.trim();
	if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
	v = v.replace(/\/+$/, '');
	return isLocalhostUrl(v) ? v : fallback;
}

export function buildHealthUrl(base: string): string {
	return `${sanitizeCompanionUrl(base)}/health`;
}

export function buildYtdlpUrl(base: string): string {
	return `${sanitizeCompanionUrl(base)}/ytdlp`;
}

export function buildOllamaUrl(base: string): string {
	return `${sanitizeCompanionUrl(base)}/ollama`;
}

export function parseHealth(raw: mixed): CompanionHealth {
	if (!raw || typeof raw !== 'object') return { ok: false };
	const r: any = raw;
	const tools: any = (r.tools && typeof r.tools === 'object') ? r.tools : {};
	return {
		ok: r.ok === true || r.status === 'ok',
		version: typeof r.version === 'string' ? r.version : undefined,
		ytdlp: r.ytdlp === true || tools.ytdlp === true,
		ffmpeg: r.ffmpeg === true || tools.ffmpeg === true,
		ollama: r.ollama === true || tools.ollama === true,
	};
}

export function buildYtdlpBody(url: string, opts: {| format: string, audioOnly: boolean |}): { [string]: mixed } {
	return {
		url,
		format: opts.format,
		audioOnly: opts.audioOnly,
	};
}
