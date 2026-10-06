import test from "node:test";
import assert from "node:assert/strict";
import { validateConfiguration } from "../packages/contracts/src/project-configuration.js";
const base = {
  schemaVersion: 1,
  name: "Demo",
  repositories: [{ key: "app", path: "." }],
};
test("portable configuration fills defaults and preserves repository-relative paths", () => {
  const m = validateConfiguration(base);
  assert.equal(m.repositories[0].path, ".");
  assert.deepEqual(m.services, []);
});
test("rejects escaping and absolute repository paths", () => {
  for (const path of ["../escape", "/tmp/absolute"])
    assert.throws(
      () =>
        validateConfiguration({
          ...base,
          repositories: [{ key: "app", path }],
        }),
      /relative|escape|contained/,
    );
});
test("rejects unknown references and combined execution cycles", () => {
  assert.throws(
    () =>
      validateConfiguration({
        ...base,
        services: [{ id: "web", repository: "missing", executable: "node" }],
      }),
    /repository/,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...base,
        setup: [
          {
            id: "install",
            repository: "app",
            executable: "node",
            dependsOn: ["service:app/web"],
          },
        ],
        services: [
          {
            id: "web",
            repository: "app",
            executable: "node",
            dependsOn: ["setup:install"],
          },
        ],
      }),
    /cycle/,
  );
});
test("URL references do not introduce execution cycles but must exist", () => {
  const services = [
    {
      id: "api",
      repository: "app",
      executable: "node",
      env: { ORIGIN: "{{service.web.url}}" },
    },
    {
      id: "web",
      repository: "app",
      executable: "node",
      env: { API: "{{service.api.url}}" },
    },
  ];
  assert.equal(validateConfiguration({ ...base, services }).services.length, 2);
  assert.throws(
    () =>
      validateConfiguration({
        ...base,
        services: [{ ...services[0], env: { BAD: "{{service.unknown.url}}" } }],
      }),
    /reference|Unknown/,
  );
});
test("rejects plaintext secret environment values and unsupported schema", () => {
  assert.throws(
    () =>
      validateConfiguration({
        ...base,
        services: [
          {
            id: "api",
            repository: "app",
            executable: "node",
            env: { DATABASE_PASSWORD: "secret" },
          },
        ],
      }),
    /secret/i,
  );
  assert.throws(
    () => validateConfiguration({ ...base, schemaVersion: 2 }),
    /version/i,
  );
});
