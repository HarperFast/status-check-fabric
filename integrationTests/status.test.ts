/**
 * Integration tests for the status-check-fabric Harper component.
 *
 * Tests the /status endpoint behavior:
 * - GET returns 200 when Available, 404 when Unavailable
 * - POST sets status to Available (authenticated)
 * - DELETE sets status to Unavailable (authenticated)
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// harper's `exports` map only exposes ".", so 'harper/dist/bin/harper.js' is not
// resolvable (ERR_PACKAGE_PATH_NOT_EXPORTED). The integration-testing harness
// auto-resolves the CLI via that deep subpath, so we resolve it from the exported
// main entry and pass it explicitly as `harperBinPath`. Documented harness escape hatch.
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

const FIXTURE_PATH = fileURLToPath(new URL('../fixture/', import.meta.url));

function authFetch(
	ctx: ContextWithHarper,
	path: string,
	init: RequestInit & { headers?: Record<string, string> } = {}
): Promise<Response> {
	const { headers = {}, ...rest } = init;
	const creds = Buffer.from(`${ctx.harper.admin.username}:${ctx.harper.admin.password}`).toString('base64');
	return fetch(`${ctx.harper.httpURL}${path}`, {
		...rest,
		headers: { ...headers, Authorization: `Basic ${creds}` },
	});
}

void suite('status-check-fabric: GET /status', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, FIXTURE_PATH, { harperBinPath });
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	void test('GET /status returns 200 or 404 (unauthenticated)', async () => {
		const res = await fetch(`${ctx.harper.httpURL}/status`);
		ok([200, 404].includes(res.status), `expected 200 or 404, got ${res.status}`);
	});

	void test('POST /status sets node to Available (authenticated)', async () => {
		const res = await authFetch(ctx, '/status', { method: 'POST' });
		ok([200, 204].includes(res.status), `expected 200 or 204, got ${res.status}`);
	});

	void test('GET /status returns 200 after POST (Available)', async () => {
		// Ensure Available first
		await authFetch(ctx, '/status', { method: 'POST' });

		const res = await fetch(`${ctx.harper.httpURL}/status`);
		strictEqual(res.status, 200);
		const text = await res.text();
		ok(text.length > 0, 'response body should not be empty');
	});

	void test('DELETE /status sets node to Unavailable (authenticated)', async () => {
		const res = await authFetch(ctx, '/status', { method: 'DELETE' });
		ok([200, 204].includes(res.status), `expected 200 or 204, got ${res.status}`);
	});

	void test('GET /status returns 404 after DELETE (Unavailable)', async () => {
		// Ensure Unavailable first
		await authFetch(ctx, '/status', { method: 'DELETE' });

		const res = await fetch(`${ctx.harper.httpURL}/status`);
		strictEqual(res.status, 404);
	});

	void test('POST /status restores node to Available again', async () => {
		await authFetch(ctx, '/status', { method: 'DELETE' });
		const setRes = await authFetch(ctx, '/status', { method: 'POST' });
		ok([200, 204].includes(setRes.status), `expected 200 or 204, got ${setRes.status}`);

		const checkRes = await fetch(`${ctx.harper.httpURL}/status`);
		strictEqual(checkRes.status, 200);
	});
});
