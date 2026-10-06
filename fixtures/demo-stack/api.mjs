import http from "node:http";
http
  .createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", process.env.UI_ORIGIN || "*");
    res.setHeader("Content-Type", "application/json");
    let resource = null;
    if (process.env.DATA_URL) {
      try {
        resource = await fetch(process.env.DATA_URL).then((r) => r.json());
      } catch {
        res.statusCode = 503;
      }
    }
    res.end(
      JSON.stringify({
        workspace: process.env.WORKSPACE_ID,
        checkout: process.cwd(),
        service: "api",
        resource,
      }),
    );
  })
  .listen(Number(process.env.PORT), "127.0.0.1");
