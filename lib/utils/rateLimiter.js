/* @flow */
// Tiny token-bucket rate limiter. Use to throttle outbound Reddit JSON
// requests so the suite stays well under Reddit's per-IP rate limits.

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

	setInterval(() => {
		available = Math.min(tokens, available + 1);
		drain();
	}, refillMs);

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
				drain();
			});
		},
		pending() { return queue.length; },
	};
}
