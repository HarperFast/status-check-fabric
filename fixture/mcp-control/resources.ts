import { Resource } from 'harper';

class McpControl extends Resource {
	get(): string {
		return 'control';
	}
}

export { McpControl as mcpcontrol };
