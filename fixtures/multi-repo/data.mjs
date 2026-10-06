import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(".data", { recursive: true });
writeFileSync(
  ".data/identity.json",
  JSON.stringify({ workspace: process.env.WORKSPACE_ID }),
);
http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        workspace: process.env.WORKSPACE_ID,
        dataRoot: process.cwd() + "/.data",
      }),
    );
  })
  .listen(Number(process.env.PORT), "127.0.0.1");
