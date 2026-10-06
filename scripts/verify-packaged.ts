import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "wm-packaged-"));
const executable = resolve(
  "release/mac-arm64/Worktree Manager.app/Contents/MacOS/Worktree Manager",
);
const clients: Client[] = [];
let pid: number | undefined;
try {
  const results = await Promise.all(
    [1, 2].map(async (index) => {
      const client = new Client({
        name: `packaged-smoke-${index}`,
        version: "1",
      });
      clients.push(client);
      const transport = new StdioClientTransport({
        command: executable,
        args: ["--mode=mcp"],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (e): e is [string, string] => e[1] !== undefined,
            ),
          ),
          WORKTREE_MANAGER_HOME: root,
        },
        stderr: "pipe",
      });
      await client.connect(transport);
      const result = await client.callTool({
        name: "controller_status",
        arguments: {},
      });
      const status = (result.structuredContent as any).result;
      assert.equal(status.protocolVersion, 1);
      return { status, tools: (await client.listTools()).tools.length };
    }),
  );
  assert.equal(results[0].status.pid, results[1].status.pid);
  pid = results[0].status.pid;
  assert.ok(results[0].tools > 45);
  console.log(
    JSON.stringify(
      {
        packagedMcp: "passed",
        sqlite: "initialized",
        sameController: pid,
        tools: results[0].tools,
        stdout: "valid MCP protocol",
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(clients.map((c) => c.close()));
  if (pid)
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  await new Promise((r) => setTimeout(r, 250));
  await rm(root, { recursive: true, force: true });
}
