/* @flow */

export type BaitSignal = {|
	pattern: string,
	label: string,
|};

export const DEFAULT_PATTERNS: BaitSignal[] = [
	{ pattern: '^AITA\\b', label: 'AITA' },
	{ pattern: '^(?:Am I|am i) (?:wrong|the asshole|overreacting|crazy)\\b', label: 'AITA-style' },
	{ pattern: '^UPDATE[:\\s]', label: 'Update bait' },
	{ pattern: '^\\[?[Uu]pdate\\]?[:\\s]', label: 'Update bait' },
	{ pattern: '^I\\s+(?:just|finally|can\'t believe)', label: 'Personal bait' },
	{ pattern: '^(?:Nobody|No one) is talking about', label: 'Outrage bait' },
	{ pattern: '^(?:Unpopular opinion|Hot take|UNPOPULAR OPINION)[:\\s]', label: 'Contrarian bait' },
	{ pattern: '^\\d+\\s+(?:things?|reasons?|ways?|tips?|facts?)\\s', label: 'Listicle' },
	{ pattern: '^(?:Top|Best|Worst)\\s+\\d+\\s', label: 'Listicle' },
	{ pattern: '^[A-Z][A-Z\\s!?,]{14,}$', label: 'ALL CAPS' },
];

export function parsePatterns(raw: string): BaitSignal[] {
	if (!raw || !raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			item => item && typeof item.pattern === 'string' && typeof item.label === 'string',
		);
	} catch {
		return [];
	}
}

export function matchTitle(title: string, patterns: BaitSignal[]): ?BaitSignal {
	for (const signal of patterns) {
		try {
			if (new RegExp(signal.pattern).test(title)) return signal;
		} catch {
			// malformed regex — skip
		}
	}
	return null;
}

export function mergePatterns(defaults: BaitSignal[], custom: BaitSignal[]): BaitSignal[] {
	const seen = new Set();
	const result: BaitSignal[] = [];
	for (const p of [...custom, ...defaults]) {
		if (!seen.has(p.pattern)) {
			seen.add(p.pattern);
			result.push(p);
		}
	}
	return result;
}
