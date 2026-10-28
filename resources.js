import { Resource, server } from 'harper';

const DEFAULT_200_MSG = 'Status endpoint is reporting for duty.';
const DEFAULT_404_MSG = 'Status endpoint is reporting downtime.';

class status extends Resource {
	allowRead() {
		return true;
	}
	async get() {
		let record = await server.operation({ operation: 'get_status', id: 'availability' });
		if (record?.status === 'Available') {
			return DEFAULT_200_MSG;
		} else {
			let err = new Error(DEFAULT_404_MSG);
			err.statusCode = 404;
			throw err;
		}
	}

	async post() {
		await server.operation({ operation: 'set_status', id: 'availability', status: 'Available' });
	}

	async delete() {
		await server.operation({ operation: 'set_status', id: 'availability', status: 'Unavailable' });
	}
}

// Not exported: jsResource registers exported resources without per-protocol options, which would
// replace this entry and expose the handlers as native MCP tools.
server.resources.set('status', status, { mcp: false });
