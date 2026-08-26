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
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

/**
 * Locate harper's CLI without assuming its internal layout.
 *
 * harper's `exports` map declares only ".", so neither `harper/package.json` nor
 * `harper/dist/bin/harper.js` is resolvable — both fail with
 * ERR_PACKAGE_PATH_NOT_EXPORTED, which is why the harness's own auto-resolution
 * doesn't work here. Resolve the main entry, walk up to the package root, and read
 * the CLI path out of harper's own `bin` field: that survives the main entry moving
 * anywhere inside the package, and fails with a named error rather than a cryptic
 * ENOENT if the package shape ever changes.
 */
function resolveHarperBinPath(): string {
	let dir = dirname(require.resolve('harper'));
	for (let i = 0; i < 10; i++) {
		const pkgPath = join(dir, 'package.json');
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
				name?: string;
				bin?: string | Record<string, string>;
			};
			if (pkg.name === 'harper') {
				const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.harper;
				if (!bin) throw new Error("harper's package.json declares no `bin.harper` entry");
				return resolve(dir, bin);
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("could not locate the harper package root from require.resolve('harper')");
}

const harperBinPath = resolveHarperBinPath();

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
		await res.text();
	});

	void test('POST /status sets node to Available (authenticated)', async () => {
		const res = await authFetch(ctx, '/status', { method: 'POST' });
		ok([200, 204].includes(res.status), `expected 200 or 204, got ${res.status}`);
		await res.text();
	});

	void test('GET /status returns 200 after POST (Available)', async () => {
		// Ensure Available first
		await (await authFetch(ctx, '/status', { method: 'POST' })).text();

		const res = await fetch(`${ctx.harper.httpURL}/status`);
		strictEqual(res.status, 200);
		const text = await res.text();
		ok(text.length > 0, 'response body should not be empty');
	});

	void test('DELETE /status sets node to Unavailable (authenticated)', async () => {
		const res = await authFetch(ctx, '/status', { method: 'DELETE' });
		ok([200, 204].includes(res.status), `expected 200 or 204, got ${res.status}`);
		await res.text();
	});

	void test('GET /status returns 404 after DELETE (Unavailable)', async () => {
		// Ensure Unavailable first
		await (await authFetch(ctx, '/status', { method: 'DELETE' })).text();

		const res = await fetch(`${ctx.harper.httpURL}/status`);
		strictEqual(res.status, 404);
		await res.text();
	});

	void test('POST /status restores node to Available again', async () => {
		await (await authFetch(ctx, '/status', { method: 'DELETE' })).text();
		const setRes = await authFetch(ctx, '/status', { method: 'POST' });
		ok([200, 204].includes(setRes.status), `expected 200 or 204, got ${setRes.status}`);
		await setRes.text();

		const checkRes = await fetch(`${ctx.harper.httpURL}/status`);
		strictEqual(checkRes.status, 200);
		await checkRes.text();
	});
});
