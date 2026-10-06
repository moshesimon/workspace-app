import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { commands } from "../../contracts/src/commands.js";
import { errorRecord } from "../../contracts/src/errors.js";
export function createMcpServer(client: {
  call: (name: string, input: any) => Promise<any>;
}) {
  const server = new McpServer({ name: "worktree-manager", version: "0.1.0" });
  for (const [name, definition] of Object.entries(commands)) {
    server.registerTool(
      name.replaceAll(".", "_"),
      {
        description: definition.description,
        inputSchema: definition.input,
        annotations: {
          readOnlyHint: !definition.mutation && !name.endsWith(".preview"),
          destructiveHint: definition.destructive ?? false,
          idempotentHint: true,
          openWorldHint: name.startsWith("pullRequests."),
        },
      },
      async (input: any) => {
        try {
          const result = await client.call(name, input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: { result },
          };
        } catch (error) {
          const record = errorRecord(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(record) }],
            structuredContent: { error: record },
          };
        }
      },
    );
  }
  return server;
}
export async function serveMcp(client: {
  call: (name: string, input: any) => Promise<any>;
}) {
  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());
  return server;
}
