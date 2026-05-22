/* @flow */
// Shared helper for the "click → 'sending…' → wait → restore text" pattern
// used by every module that triggers an async download. Keeps the timer
// state outside the DOM so rapid double-clicks don't fight each other and
// orphaned timers don't leave a misleading message behind.

const timers: WeakMap<HTMLElement, TimeoutID> = new WeakMap();

export function flashStatus(
	el: ?HTMLElement,
	message: string,
	options?: {| restore?: string, durationMs?: number |},
): void {
	if (!(el instanceof HTMLElement)) return;
	const previous = timers.get(el);
	if (previous) {
		clearTimeout(previous);
		timers.delete(el);
	}
	el.textContent = message;
	const opts = options || {};
	const restore = opts.restore;
	if (typeof restore !== 'string') return;
	const durationMs = Number.isFinite(opts.durationMs) && (opts.durationMs: any) > 0
		? (opts.durationMs: any)
		: 4000;
	const timer = setTimeout(() => {
		// Guard against the button being detached between scheduling and firing.
		if (el.isConnected) el.textContent = restore;
		timers.delete(el);
	}, durationMs);
	timers.set(el, timer);
}

// Convenience for the common case "show 'sending…' immediately, restore on
// completion or failure". Returns a function that updates the message + sets
// up the restore timer. Callers don't need to manage the timer themselves.
export function makeStatusReporter(el: HTMLElement, defaultLabel: string): (msg: string) => void {
	return (msg: string) => {
		flashStatus(el, msg, { restore: defaultLabel, durationMs: 5000 });
	};
}
