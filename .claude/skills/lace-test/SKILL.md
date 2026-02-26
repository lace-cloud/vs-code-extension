---
name: lace-test
description: >
  Testing patterns for Lace. Use when working on any file in
  src/webview/__tests__/, when writing new tests, when someone asks
  to add test coverage, or when fixing a failing test. Also activate
  when adding a new reducer action (tests are mandatory).
---

## Framework

Vitest, not Jest. Config in `vitest.config.ts`.

```bash
npm run test:unit        # 238 unit tests, no binary needed
npm run test:e2e         # 6 tests, requires lace + terraform binaries
npm run test:watch       # Watch mode (unit tests)
npm test                 # All tests
```

Always run `npm run test:unit` after any change. ALL tests must pass.

## Unit Test Conventions

Tests are pure logic — no external processes, no filesystem, no network.

### Workspace Factory

Use shared helpers from `__tests__/helpers.ts`. Key exports:

- `makeWorkspace(instances, modules?, layouts?, exports?, inputs?)` — builds a valid `WorkspaceState` with a root composite
- `makeEmptyWorkspace()` — shorthand for `makeWorkspace([])`
- `loadFixture(name)` — loads JSON from `__tests__/fixtures/`
- `getGraph`, `getInst`, `getInstances`, `getExports` — accessor helpers
- `vpcDef`, `subnetDef` — common module definitions for tests

Example:

```typescript
import { makeWorkspace, getInst } from './helpers';

const ws = makeWorkspace([
  { id: 'vpc', kind: 'module', use: { module_id: 'vpc', version: 'v1.0.0' }, inputs: {} },
  {
    id: 'web',
    kind: 'module',
    use: { module_id: 'web', version: 'v1.0.0' },
    inputs: {
      vpc_id: { out: { module: 'vpc', name: 'vpc_id' } },
    },
  },
]);
```

For bundle tests, use `emptyWorkspace()` from `utils/bundle.ts`.

### Test Structure

```typescript
describe('RENAME_INSTANCE', () => {
  it('should cascade rename to sibling out bindings', () => {
    // Arrange
    const ws = makeWorkspace({ instances: [...] });

    // Act
    const result = workspaceReducer(ws, {
      type: 'RENAME_INSTANCE',
      module_key: ROOT_KEY,
      old_id: 'vpc',
      new_id: 'network',
    });

    // Assert — check all cascade targets
    const graph = result.modules[ROOT_KEY].graph;
    // 1. Sibling out bindings updated
    // 2. Export outputs updated
    // 3. depends_on entries updated
    // 4. Layout keys updated
  });
});
```

### Test Naming

Descriptive names that state behavior, not implementation:

- ✅ `it('should cascade delete to sibling out bindings')`
- ✅ `it('should normalize missing kind to module')`
- ❌ `it('tests handleDeleteInstance')`
- ❌ `it('works correctly')`

## Test File Mapping

| Source                                | Test File                              |
| ------------------------------------- | -------------------------------------- |
| `state/reducer.ts` (core editing)     | `reducer.test.ts` (786 lines)          |
| `state/reducer.ts` (terraform config) | `terraform-config.test.ts` (626 lines) |
| `utils/bundle.ts`                     | `bundle.test.ts`                       |
| `utils/validate.ts`                   | `validate.test.ts`                     |
| `utils/derive.ts`                     | `derive.test.ts`                       |
| `utils/resolve.ts`                    | `resolve.test.ts`                      |
| `utils/identifiers.ts`                | `identifiers.test.ts`                  |
| `utils/normalize` (binding/instance)  | `normalize.test.ts`                    |
| `utils/parseValue` (HCL literals)     | `parseValue.test.ts`                   |
| `utils/infer` (type inference)        | `infer.test.ts`                        |
| `chat/auto-connect.ts`                | `auto-connect.test.ts`                 |
| `chat/graph-summary.ts`               | `graph-summary.test.ts`                |
| `chat/tools/graph-write-tools.ts`     | `chat-tools.test.ts`                   |
| `chat/tools/registry-tools.ts`        | `registry-tools.test.ts`               |
| Nested composite pipeline             | `iam-stack.test.ts`                    |
| `emptyWorkspace` factory              | `scaffold.test.ts`                     |
| `components/panels/PanelFrame`        | `PanelFrame.test.tsx`                  |
| Full RPC pipeline                     | `e2e-rpc-integration.test.ts`          |

New reducer actions go in `reducer.test.ts`. New terraform config actions
go in `terraform-config.test.ts`. New utility functions get their own test
file or extend the matching one.

## Fixtures

`__tests__/fixtures/` contains real CLI bundle snapshots as JSON:

- `full_bundle_with_terraform.json`
- `leaf_deploy_bundle.json`
- `bundle_with_bad_module.json`
- `composite_deploy_bundle.json`
- `iam_stack_deploy_bundle.json`
- `policy_attachment_deploy_bundle.json`

Use these for `fromBundle`/`toBundle` round-trip tests. Do not fabricate
bundle JSON by hand when a fixture exists.

## E2E Test Pattern

E2E tests spawn the real `lace` binary. They require `lace` and `terraform`
to be installed. Set `LACE_BINARY=/path/to/lace` to override PATH lookup.

```typescript
let proc: ChildProcess;
let client: JSONRPCClient;

beforeEach(async () => {
  ({ proc, client } = spawnServer(binary));
  await client.initialize('0.1.0');
});

afterEach(() => {
  proc.kill();
  client.dispose();
});

it('should validate and generate', async () => {
  const ws = emptyWorkspace();
  // ... build workspace via reducer actions
  const bundle = toBundle(ws);
  const validation = await client.validate({ bundle });
  const result = await client.call('generate', { bundle, outputDir: tmpDir });
  // assert on files written
});
```

## What Needs Tests

Every new reducer action MUST have tests. Every bug fix MUST have a
regression test. Specifically test:

- Happy path
- Edge cases (empty arrays, missing optional fields)
- Cascade correctness (rename/delete propagation)
- Go `omitempty` quirks (missing `kind` normalized to `'module'`)
- Round-trip fidelity (`fromBundle(toBundle(ws))` preserves semantics)
