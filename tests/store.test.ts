import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/controller/src/store.js";
import { OperationStore } from "../packages/controller/src/operations/store.js";
test("state survives reopening and operation keys cannot be rebound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wm-store-"));
  let store = new Store(dir);
  try {
    store.put("projects", { id: "p", name: "Example" });
    store.close();
    store = new Store(dir);
    assert.equal(store.get<any>("projects", "p")?.name, "Example");
    const ops = new OperationStore(store);
    let calls = 0;
    const a = ops.run(
      "example",
      { idempotencyKey: "one", value: 1 },
      async () => ++calls,
    );
    const b = ops.run(
      "example",
      { idempotencyKey: "one", value: 1 },
      async () => ++calls,
    );
    assert.equal(a.id, b.id);
    assert.throws(
      () =>
        ops.run("example", { idempotencyKey: "one", value: 2 }, async () => 0),
      /different input/,
    );
    await ops.wait(a.id, 1000);
    assert.equal(calls, 1);
    assert.equal(ops.get(a.id).status, "succeeded");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
