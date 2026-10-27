// An ordinary exported resource. Native MCP must still list its tool, which proves the
// inventory is live when the status resource contributes nothing to it.
export class mcpcontrol extends Resource {
	get() {
		return 'control';
	}
}
