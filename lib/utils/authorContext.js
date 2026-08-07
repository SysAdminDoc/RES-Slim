/* @flow */
// Pure helpers for the authorContextBadge module. Normalises the Reddit
// /user/<u>/about.json shape and formats the inline badge text.
// Dependency-free so it can be unit-tested without DOM/network.

export type AuthorAbout = {|
	username: string,
	createdUtc: number,
	linkKarma: number,
	commentKarma: number,
	totalKarma: number,
	isMod: boolean,
	isGold: boolean,
	verified: boolean,
	hasVerifiedEmail: boolean,
	fetchedAt: number, // ms timestamp
|};

function num(v: mixed, fallback: number = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function str(v: mixed): string {
	return typeof v === 'string' ? v : '';
}

export function parseAuthorAbout(raw: mixed, now: number = Date.now()): AuthorAbout | null {
	if (!raw || typeof raw !== 'object') return null;
	const r: any = raw;
	const data = r.data && typeof r.data === 'object' ? r.data : r;
	if (!data || typeof data !== 'object') return null;
	const username = str(data.name);
	if (!username) return null;
	const linkKarma = num(data.link_karma);
	const commentKarma = num(data.comment_karma);
	return {
		username,
		createdUtc: num(data.created_utc),
		linkKarma,
		commentKarma,
		totalKarma: num(data.total_karma, linkKarma + commentKarma),
		isMod: data.is_mod === true,
		isGold: data.is_gold === true,
		verified: data.verified === true,
		hasVerifiedEmail: data.has_verified_email === true,
		fetchedAt: now,
	};
}

const DAY = 60 * 60 * 24;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

export function formatAccountAge(createdUtc: number, nowMs: number = Date.now()): string {
	if (!createdUtc) return '?';
	const seconds = Math.max(0, nowMs / 1000 - createdUtc);
	if (seconds < DAY) return '<1d';
	if (seconds < MONTH) return `${Math.floor(seconds / DAY)}d`;
	if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo`;
	const years = Math.floor(seconds / YEAR);
	const remMonths = Math.floor((seconds - years * YEAR) / MONTH);
	return remMonths > 0 ? `${years}y${remMonths}mo` : `${years}y`;
}

export function formatKarma(value: number): string {
	if (!Number.isFinite(value)) return '?';
	const abs = Math.abs(value);
	if (abs < 1000) return String(value);
	if (abs < 1_000_000) {
		const n = value / 1000;
		// One decimal until 100k, then no decimals.
		if (Math.abs(n) < 100) return `${n.toFixed(1).replace(/\.0$/, '')}k`;
		return `${Math.round(n)}k`;
	}
	const m = value / 1_000_000;
	return Math.abs(m) < 100 ? `${m.toFixed(1).replace(/\.0$/, '')}m` : `${Math.round(m)}m`;
}

export function formatBadge(
	about: AuthorAbout,
	opts: {| showAge: boolean, showKarma: boolean |},
	nowMs: number = Date.now(),
): string {
	const parts: string[] = [];
	if (opts.showAge) parts.push(formatAccountAge(about.createdUtc, nowMs));
	if (opts.showKarma) parts.push(formatKarma(about.totalKarma || (about.linkKarma + about.commentKarma)));
	return parts.join(' · ');
}

export function isFresh(about: AuthorAbout, ttlMs: number, nowMs: number = Date.now()): boolean {
	if (!about || !about.fetchedAt) return false;
	return nowMs - about.fetchedAt < ttlMs;
}

export function ageRiskClass(createdUtc: number, nowMs: number = Date.now()): 'new' | 'young' | 'mature' {
	if (!createdUtc) return 'mature';
	const days = (nowMs / 1000 - createdUtc) / DAY;
	if (days < 30) return 'new';
	if (days < 180) return 'young';
	return 'mature';
}
