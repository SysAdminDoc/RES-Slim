/* @flow */
// Tiny token-bucket rate limiter. Use to throttle outbound Reddit JSON
// requests so the suite stays well under Reddit's per-IP rate limits.
//
// Refactor v0.12 hardening pass: the refill interval is now lazy. It only
// starts when a job is scheduled, and stops itself once the queue drains
// and the bucket is full again. Modules that never call `schedule()` (e.g.
// a disabled module that loaded the limiter at import time) now hold no
// timer at all.

type Job<T> = {| run: () => Promise<T>, resolve: T => void, reject: any => void |};

export type RateLimiter = {|
	schedule: <T>(job: () => Promise<T>) => Promise<T>,
	pending: () => number,
|};

export function createRateLimiter({
	tokens,
	refillMs,
	maxConcurrent = 4,
}: {|
	tokens: number,
	refillMs: number,
	maxConcurrent?: number,
|}): RateLimiter {
	let available = tokens;
	const queue: Job<any>[] = [];
	let active = 0;
	let refillTimer: ?IntervalID = null;

	function startRefillIfNeeded(): void {
		if (refillTimer !== null) return;
		refillTimer = setInterval(() => {
			available = Math.min(tokens, available + 1);
			drain();
			// Idle when there's nothing waiting AND the bucket is full. Stop the
			// timer; schedule() will restart it on next demand.
			if (available >= tokens && queue.length === 0 && active === 0) {
				if (refillTimer !== null) {
					clearInterval(refillTimer);
					refillTimer = null;
				}
			}
		}, refillMs);
	}

	function drain() {
		while (queue.length && available > 0 && active < maxConcurrent) {
			const job = queue.shift();
			if (!job) return;
			available -= 1;
			active += 1;
			job.run().then(
				value => { active -= 1; job.resolve(value); drain(); },
				err => { active -= 1; job.reject(err); drain(); },
			);
		}
	}

	return {
		schedule<T>(run: () => Promise<T>): Promise<T> {
			return new Promise((resolve, reject) => {
				queue.push({ run, resolve, reject });
				startRefillIfNeeded();
				drain();
			});
		},
		pending() { return queue.length; },
	};
}
