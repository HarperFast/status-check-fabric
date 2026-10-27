/**
 * Integration tests for the status-check-fabric Harper component.
 *
 * The production config.yaml and resources.js are staged unmodified as an installed component, so
 * these tests exercise the shipped registration rather than a copy of the handlers. Native MCP's
 * application profile is enabled alongside an ordinary control component, so an empty or disabled
 * MCP surface cannot satisfy the exclusion assertions.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert/strict';
import { startHarper, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
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

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONTROL_COMPONENT_PATH = fileURLToPath(new URL('../fixture/mcp-control/', import.meta.url));

const AVAILABLE_MESSAGE = 'Status endpoint is reporting for duty.';
const UNAVAILABLE_MESSAGE = 'Status endpoint is reporting downtime.';
const STATUS_TOOLS = ['create_status', 'delete_status', 'get_status'];
const CONTROL_TOOL = 'get_mcpcontrol';

const WRITER = { username: 'status_table_writer', password: 'Writer1234!' };
const READER = { username: 'status_no_perms', password: 'Reader1234!' };

async function stageComponents(): Promise<string> {
	const dataRootDir = await mkdtemp(
		join(process.env.HARPER_INTEGRATION_TEST_INSTALL_PARENT_DIR || tmpdir(), 'harper-integration-test-')
	);
	const componentDir = join(dataRootDir, 'components', 'status-check-fabric');
	await mkdir(componentDir, { recursive: true });
	for (const file of ['config.yaml', 'resources.js']) {
		await cp(join(REPO_ROOT, file), join(componentDir, file));
	}
	await cp(CONTROL_COMPONENT_PATH, join(dataRootDir, 'components', 'mcp-control'), { recursive: true });
	return dataRootDir;
}

function basicAuth(credentials: { username: string; password: string }): Record<string, string> {
	const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
	return { Authorization: `Basic ${encoded}` };
}

async function statusRequest(
	ctx: ContextWithHarper,
	method: string,
	credentials?: { username: string; password: string }
): Promise<{ status: number; body: string }> {
	const res = await fetch(`${ctx.harper.httpURL}/status`, {
		method,
		headers: credentials ? basicAuth(credentials) : {},
	});
	return { status: res.status, body: await res.text() };
}

async function operation(ctx: ContextWithHarper, body: Record<string, unknown>): Promise<any> {
	const res = await fetch(ctx.harper.operationsAPIURL, {
		method: 'POST',
		headers: { ...basicAuth(ctx.harper.admin), 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const result = await res.json();
	strictEqual(res.status, 200, `${String(body.operation)} failed: ${JSON.stringify(result)}`);
	return result;
}

async function getStatus(ctx: ContextWithHarper): Promise<string | undefined> {
	const record = await operation(ctx, { operation: 'get_status', id: 'availability' });
	return record?.status;
}

async function setStatus(ctx: ContextWithHarper, value: string): Promise<void> {
	await operation(ctx, { operation: 'set_status', id: 'availability', status: value });
}

interface JsonRpcResponse {
	result?: any;
	error?: { code: number; message: string };
}

async function mcpPost(
	ctx: ContextWithHarper,
	message: Record<string, unknown>,
	sessionId?: string
): Promise<{ status: number; sessionId: string | null; json: JsonRpcResponse | undefined }> {
	const headers: Record<string, string> = {
		...basicAuth(ctx.harper.admin),
		'Content-Type': 'application/json',
		'Accept': 'application/json, text/event-stream',
		'MCP-Protocol-Version': '2025-06-18',
	};
	if (sessionId) headers['Mcp-Session-Id'] = sessionId;
	const res = await fetch(`${ctx.harper.httpURL}/mcp`, { method: 'POST', headers, body: JSON.stringify(message) });
	const text = await res.text();
	let json: JsonRpcResponse | undefined;
	if (text) {
		const payload = (res.headers.get('content-type') ?? '').includes('text/event-stream')
			? text
					.split('\n')
					.filter((line) => line.startsWith('data:'))
					.map((line) => line.slice(5).trim())
					.pop()
			: text;
		if (payload) json = JSON.parse(payload) as JsonRpcResponse;
	}
	return { status: res.status, sessionId: res.headers.get('mcp-session-id'), json };
}

async function listNativeMcpTools(ctx: ContextWithHarper): Promise<string[]> {
	const init = await mcpPost(ctx, {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'status-check-fabric-test', version: '1.0.0' },
		},
	});
	strictEqual(init.status, 200, `MCP initialize failed: ${JSON.stringify(init.json)}`);
	ok(init.sessionId, 'MCP initialize returned no session id');
	const sessionId = init.sessionId;
	await mcpPost(ctx, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);

	const names: string[] = [];
	let cursor: string | undefined;
	for (let id = 2; id < 100; id++) {
		const page = await mcpPost(
			ctx,
			{ jsonrpc: '2.0', id, method: 'tools/list', params: cursor ? { cursor } : {} },
			sessionId
		);
		strictEqual(page.status, 200, `MCP tools/list failed: ${JSON.stringify(page.json)}`);
		ok(page.json?.result, `MCP tools/list returned no result: ${JSON.stringify(page.json)}`);
		for (const tool of page.json.result.tools as { name: string }[]) names.push(tool.name);
		cursor = page.json.result.nextCursor;
		if (!cursor) return names;
	}
	throw new Error('MCP tools/list did not finish paginating');
}

// The status component reaches the registry differently under the native module loader, which is
// an opt-in Harper setting, so both loaders run the same assertions.
const MODULE_LOADERS = [
	{ label: 'default module loader', config: {} },
	{ label: 'native module loader', config: { applications: { moduleLoader: 'native' } } },
];

for (const loader of MODULE_LOADERS) {
	void suite(`status-check-fabric with the ${loader.label}: native MCP and HTTP`, (ctx: ContextWithHarper) => {
		before(async () => {
			ctx.harper = { dataRootDir: await stageComponents() } as ContextWithHarper['harper'];
			await startHarper(ctx, {
				harperBinPath,
				config: {
					...loader.config,
					authentication: { authorizeLocal: false },
					mcp: { application: { mountPath: '/mcp' } },
				},
			});

			await operation(ctx, {
				operation: 'create_table',
				database: 'data',
				table: 'hdb_status',
				primary_key: 'id',
			});
			await operation(ctx, {
				operation: 'add_role',
				role: 'status_table_writer',
				permission: {
					super_user: false,
					data: {
						tables: {
							hdb_status: { read: true, insert: true, update: true, delete: true, attribute_permissions: [] },
						},
					},
				},
			});
			await operation(ctx, { operation: 'add_role', role: 'status_no_perms', permission: { super_user: false } });
			await operation(ctx, { operation: 'add_user', role: 'status_table_writer', active: true, ...WRITER });
			await operation(ctx, { operation: 'add_user', role: 'status_no_perms', active: true, ...READER });
		});

		after(async () => {
			await teardownHarper(ctx);
		});

		void test('native MCP lists the control tool but none of the status tools', async () => {
			const names = await listNativeMcpTools(ctx);
			ok(names.includes(CONTROL_TOOL), `control tool missing, so the inventory is not live: ${names.join(', ')}`);
			deepStrictEqual(
				STATUS_TOOLS.filter((name) => names.includes(name)),
				[],
				`status tools exposed over native MCP: ${names.join(', ')}`
			);
		});

		void test('anonymous GET /status reports Available with 200 and Unavailable with 404', async () => {
			await setStatus(ctx, 'Available');
			const available = await statusRequest(ctx, 'GET');
			strictEqual(available.status, 200);
			ok(available.body.includes(AVAILABLE_MESSAGE), `unexpected body: ${available.body}`);

			await setStatus(ctx, 'Unavailable');
			const unavailable = await statusRequest(ctx, 'GET');
			strictEqual(unavailable.status, 404);
			ok(unavailable.body.includes(UNAVAILABLE_MESSAGE), `unexpected body: ${unavailable.body}`);
		});

		void test('superuser POST sets Available and DELETE sets Unavailable', async () => {
			await setStatus(ctx, 'Unavailable');
			const posted = await statusRequest(ctx, 'POST', ctx.harper.admin);
			ok([200, 204].includes(posted.status), `POST returned ${posted.status}: ${posted.body}`);
			strictEqual(await getStatus(ctx), 'Available');
			strictEqual((await statusRequest(ctx, 'GET')).status, 200);

			const deleted = await statusRequest(ctx, 'DELETE', ctx.harper.admin);
			ok([200, 204].includes(deleted.status), `DELETE returned ${deleted.status}: ${deleted.body}`);
			strictEqual(await getStatus(ctx), 'Unavailable');
			strictEqual((await statusRequest(ctx, 'GET')).status, 404);
		});

		const rejectedCallers = [
			{ label: 'anonymous', credentials: undefined, expectedStatus: 401 },
			{ label: 'table-writer role', credentials: WRITER, expectedStatus: 403 },
			{ label: 'role without permissions', credentials: READER, expectedStatus: 403 },
		];
		for (const { label, credentials, expectedStatus } of rejectedCallers) {
			void test(`${label} POST and DELETE are rejected and leave availability unchanged`, async () => {
				await setStatus(ctx, 'Unavailable');
				const posted = await statusRequest(ctx, 'POST', credentials);
				strictEqual(posted.status, expectedStatus, `POST body: ${posted.body}`);
				strictEqual(await getStatus(ctx), 'Unavailable');

				await setStatus(ctx, 'Available');
				const deleted = await statusRequest(ctx, 'DELETE', credentials);
				strictEqual(deleted.status, expectedStatus, `DELETE body: ${deleted.body}`);
				strictEqual(await getStatus(ctx), 'Available');
			});
		}
	});
}
