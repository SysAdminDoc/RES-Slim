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

const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseLocalhostUrl(raw: mixed): ?URL {
	if (typeof raw !== 'string' || !raw.trim()) return null;
	let url;
	try {
		url = new URL(raw.trim());
	} catch (err) {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username || url.password) return null;
	if (!LOCALHOST_HOSTS.has(url.hostname.toLowerCase())) return null;
	return url;
}

export function isLocalhostUrl(raw: mixed): boolean {
	return !!parseLocalhostUrl(raw);
}

export function sanitizeCompanionUrl(raw: mixed, fallback: string = 'http://127.0.0.1:7860'): string {
	if (typeof raw !== 'string' || !raw.trim()) return fallback;
	let v = raw.trim();
	if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(v)) v = `http://${v}`;
	const url = parseLocalhostUrl(v);
	if (!url) return fallback;
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/+$/, '') || fallback;
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

export function looksLikeDownloadUrl(url: mixed): boolean {
	if (typeof url !== 'string') return false;
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch (err) {
		return false;
	}
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
