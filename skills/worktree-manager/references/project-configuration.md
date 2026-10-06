# Portable project configuration, schemaVersion 1

The manifest contains `name`, `repositories`, `prerequisites`, `setup`, `services`, `resources`, `bindings`, and `entrypoints`. Repositories are `{key,path,sourceRef?}` with logical keys and paths relative to the selected project root. Arrays/maps default empty; cwd defaults `.` and command args default `[]`. There must be at least one repository.

Execution items have `id`, `repository`, `args`, `cwd`, `env`, and `dependsOn`. Setup and services require `executable`. Use executable/argument arrays; declare a shell wrapper explicitly only when the established project workflow needs it. Cwd and runtime/disposable paths are relative to their checkout and cannot escape it.

Preparation items add `runPolicy: "oncePerInputs" | "always"` and optional `probe: {executable,args}`. Successful matching receipts can be reused; changed source/configuration inputs invalidate them. Prerequisites are `{id,executable,args?}` and are checked independently of workspace preparation.

Services add `runtimePaths`, optional `port: {preferred,min,max}`, optional `readiness: {type:"http"|"tcp"|"process",path?,timeoutMs?}`, and optional `url`. Ports must be integers from 1024 to 65535 within the declared range. Runtime paths identify writable instance-local data/generated configuration.

Resources add `adapter: "process" | "command" | "external"`, optional executable/port/url, and `disposablePaths`. Process adapters need an executable. Command adapters need all four `hooks: {start,status,stop,destroy}`, each a command object. The status hook must report verifiable identity/namespace/ports/ownership. External resources require a URL and are retained by Stop/Destroy. Inspect an existing resource workflow before declaring it supported or isolated.

Execution dependencies use `setup:<id>`, `resource:<id>`, or `service:<repository>/<id>`. The combined graph must be acyclic and all references must exist. URL references do not impose start-order edges, allowing an API to receive the future UI origin before the UI starts.

Templates use double braces: `{{workspace.id}}`, `{{checkout.path}}`, `{{self.port}}`, `{{self.url}}`, `{{service.<id>.url}}`, `{{service.<repository>/<id>.url}}`, `{{resource.<id>.url}}`, and `{{secret.<NAME>}}`. Secrets are resolved locally and excluded from portable exports. `bindings` maps a logical reference or `<repository>/<reference>` to `<repository>/<service>`; service references without a repository default to the same checkout. Declare cross-repository bindings explicitly. Entry points are `{label,service:"<repository>/<id>"}`.

This small example illustrates the contract; derive executable names, scripts, source refs, ports, and probes from the selected project instead of copying the example as its recipe:

```json
{
  "schemaVersion": 1,
  "name": "Example project",
  "repositories": [{ "key": "app", "path": ".", "sourceRef": "main" }],
  "prerequisites": [
    { "id": "node", "executable": "node", "args": ["--version"] }
  ],
  "setup": [
    {
      "id": "install",
      "repository": "app",
      "executable": "npm",
      "args": ["ci"],
      "cwd": ".",
      "env": {},
      "dependsOn": [],
      "runPolicy": "oncePerInputs"
    }
  ],
  "services": [
    {
      "id": "web",
      "repository": "app",
      "executable": "npm",
      "args": ["run", "dev", "--", "--port", "{{self.port}}"],
      "cwd": ".",
      "env": {},
      "dependsOn": ["setup:install"],
      "runtimePaths": [],
      "port": { "preferred": 4100, "min": 4100, "max": 4199 },
      "readiness": { "type": "http", "path": "/", "timeoutMs": 15000 },
      "url": "http://127.0.0.1:{{self.port}}"
    }
  ],
  "resources": [],
  "bindings": {},
  "entrypoints": [{ "label": "Open application", "service": "app/web" }]
}
```

Use `configuration_validate` for actual schema/reference checks. Import creates an immutable revision; each workspace remains pinned until `configuration_apply` explicitly selects the new revision while stopped. Inspect missing checkout roles and setup/resource differences before applying. Moving a root preserves logical paths; rebind registered repositories instead of embedding machine-specific paths into the export.
