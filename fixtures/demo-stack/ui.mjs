import http from "node:http";
const api = process.env.API_URL;
http
  .createServer(async (req, res) => {
    if (req.url === "/marker") {
      try {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            workspace: process.env.WORKSPACE_ID,
            api,
            backend: await fetch(api).then((r) => r.json()),
          }),
        );
      } catch (e) {
        res.statusCode = 503;
        res.end(String(e));
      }
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><html><head><title>Workspace demo</title><style>body{font:18px system-ui;background:#f6f8f5;margin:8vw;color:#25332b}main{padding:32px;border:1px solid #dce5dc;border-radius:20px;background:white;max-width:650px}code{font-size:14px;overflow-wrap:anywhere}h1{letter-spacing:-1px}pre{white-space:pre-wrap;font-size:14px}</style></head><body><main><small>WORKTREE MANAGER / LIVE DEMO</small><h1>A stack of your own.</h1><p>Workspace <code>${process.env.WORKSPACE_ID}</code></p><p>API <code>${api}</code></p><pre id="marker">Checking routing…</pre><script>fetch('/marker').then(r=>r.json()).then(v=>document.querySelector('#marker').textContent=JSON.stringify(v,null,2))</script></main></body></html>`,
    );
  })
  .listen(Number(process.env.PORT), "127.0.0.1");
