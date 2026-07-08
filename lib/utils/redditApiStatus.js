/* @flow */
// RES-Slim: shared classification for Reddit API failures.
//
// Reddit killed unauthenticated `.json` access (403) on 2026-05-30 and throttles
// authenticated polling (429). Many modules fetch `<url>.json` and previously
// swallowed non-2xx responses silently. These pure helpers classify a failure so
// callers can surface a single, throttled, user-facing notice and back off.

export const FORBIDDEN_STATUSES = [401, 403];
export const RATE_LIMITED_STATUS = 429;

export type ApiBlockKind = 'forbidden' | 'rateLimited' | 'other';

// Statuses that mean "Reddit refused/limited this request" rather than a plain
// network blip or a 404. These are the ones worth telling the user about.
export function isApiBlockStatus(status: mixed): boolean {
	return status === 401 || status === 403 || status === RATE_LIMITED_STATUS;
}

export function classifyApiStatus(status: mixed): ApiBlockKind {
	if (status === RATE_LIMITED_STATUS) return 'rateLimited';
	if (status === 401 || status === 403) return 'forbidden';
	return 'other';
}

// Extract a numeric HTTP status from whatever a fetch path threw. Supports a
// thrown object carrying `.status`, and the `status <n>` / `status: <n>` /
// `status=<n>` message convention several modules use with a bare Error.
export function getStatusFromError(error: mixed): number | null {
	if (error && typeof error === 'object') {
		const status = (error: any).status;
		if (typeof status === 'number' && Number.isFinite(status)) return status;
		const message = (error: any).message;
		if (typeof message === 'string') {
			const match = /status[\s:=]+(\d{3})/i.exec(message);
			if (match) return Number(match[1]);
		}
	}
	return null;
}

// Plain-English fallback description (i18n keys are mapped by the notifier).
export function describeApiBlock(kind: ApiBlockKind): string {
	switch (kind) {
		case 'forbidden':
			return 'Reddit blocked this request. Make sure you are logged in — Reddit removed anonymous data access.';
		case 'rateLimited':
			return 'Reddit is rate-limiting requests. Slowing down for a bit.';
		default:
			return 'Reddit could not complete this request.';
	}
}

type NotifierOptions = {|
	notify: (kind: ApiBlockKind, status: number) => mixed,
	now?: () => number,
	throttleMs?: number,
|};

// Wrap a notify callback so repeated failures (a burst of failing `.json` calls)
// produce at most one notice per throttle window. Returns true when it fired.
export function createApiBlockNotifier({ notify, now = () => Date.now(), throttleMs = 30000 }: NotifierOptions): (status: mixed) => boolean {
	let lastFiredAt = -Infinity;
	return (status: mixed): boolean => {
		if (!isApiBlockStatus(status)) return false;
		const t = now();
		if (t - lastFiredAt < throttleMs) return false;
		lastFiredAt = t;
		notify(classifyApiStatus(status), Number(status));
		return true;
	};
}
