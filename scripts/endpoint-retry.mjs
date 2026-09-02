export const MAX_TRANSPORT_ATTEMPTS = 3;

// A gateway status is retried like a transport failure, and for the same reason:
// it says the request did not reach a working server, not that the service is
// gone. web.archive.org's CDX API flaps between 200 and 503 from this machine
// within seconds - measured three times on 2026-09-02, from the gate's own fetch
// and from a second client - and one 503 failed the whole push, which is how
// three pushes in a row ended up going out with `--no-verify` and skipping every
// other gate too. CLAUDE.md records the same host doing this on 2026-08-19.
//
// This does not hide a dead host: three gateway errors in a row still fail, and
// every other status still fails on the first answer. What it stops is a
// flapping host reading exactly like a gone one.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const defaultWait = attempt => new Promise(resolve => {
	setTimeout(resolve, attempt * 250);
});

export function withTransportRetries(run, options = {}) {
	const maxAttempts = options.maxAttempts || MAX_TRANSPORT_ATTEMPTS;
	const wait = options.wait || defaultWait;

	async function attempt(number) {
		const result = await run();
		const retryable = result.status === 0 || RETRYABLE_STATUSES.has(result.status);
		if (result.ok || !retryable || number >= maxAttempts) {
			return { ...result, attempts: number };
		}
		await wait(number);
		return attempt(number + 1);
	}

	return attempt(1);
}
