console.log("worker ready", process.env.WORKSPACE_ID);
setInterval(() => console.log("heartbeat", process.env.WORKSPACE_ID), 30000);
