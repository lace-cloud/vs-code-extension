/**
 * Canvas integration / contract tests.
 *
 * One test per flow story. Each:
 *   1. Navigates to the Storybook iframe URL for the story
 *   2. Waits for the `[data-flow-ready]` marker — the FlowDecorator
 *      renders this once TestSessionOpen + Subscribe + initial
 *      StateUpdated have completed against the real `lace engine`
 *      (spawned in CI via the R2 test bundle)
 *   3. Asserts shape-level DOM invariants (node counts, data attributes,
 *      pin counts) that prove the engine → canvas pipeline is wired
 *      correctly end-to-end
 *
 * These are NOT visual regression tests. Visual regression for
 * components lives in Chromatic via Storybook mode; flow-level visual
 * regression is a gap today (planned to be filled by adding
 * MSW-mocked flow stories to Storybook in a later session, so those
 * visuals flow through the same Chromatic pipeline).
 *
 * What this suite catches that nothing else does:
 *   - CLI↔extension wire-format regressions (proto fields, Action
 *     oneof shapes, Subscribe event types)
 *   - Engine handshake / auth / Subscribe stream bugs
 *   - ReactFlow / xyflow upgrades that break real-DOM rendering
 *   - Fixture-to-render drift (amplified by the seed-drift canary
 *     in tests/flow/seed-manifest.spec.ts)
 *
 * `drift-badge` is intentionally absent: lace-cli's `pb.RenderNode` has
 * no drift metadata yet. Followup once the proto extends.
 */

import { expect, test } from '@playwright/test';

// Shared story URL helper — Storybook serves each story in an iframe at
// /iframe.html?id=<kebab-title>--<kebab-name>&viewMode=story.
function storyUrl(storyId: string): string {
  return `/iframe.html?id=${storyId}&viewMode=story`;
}

// Shared setup: navigate, wait for FlowDecorator's readiness marker
// (session open + Subscribe + initial state applied), then wait for
// ReactFlow's own measure pass to settle so screenshots capture a
// stable layout instead of a mid-transform frame.
async function gotoStory(page: import('@playwright/test').Page, storyId: string) {
  await page.goto(storyUrl(storyId));
  await page.waitForSelector('[data-flow-ready]', { state: 'attached', timeout: 15_000 });
  // ReactFlow positions nodes via `transform: translate(x, y)` on each
  // `.react-flow__node`. Until the measure pass runs, transforms are
  // empty/identity and the node sits at the origin. Wait until every
  // rendered node carries a translate — that's the real "layout
  // stable" signal, not an arbitrary sleep.
  await page.waitForFunction(
    () => {
      const nodes = document.querySelectorAll<HTMLElement>('.react-flow__node');
      if (nodes.length === 0) return true;
      return Array.from(nodes).every((n) => {
        const t = n.style.transform || '';
        return /translate\(/.test(t) || /matrix\(/.test(t);
      });
    },
    undefined,
    { timeout: 5_000 },
  );
}

test.describe('flow story golden paths', () => {
  test('empty-state: empty canvas, no nodes, no errors', async ({ page }) => {
    await gotoStory(page, 'flows-emptycanvas--default');
    // Canvas mounts but no ReactFlow nodes render.
    const nodeCount = await page.locator('.react-flow__node').count();
    expect(nodeCount).toBe(0);
  });

  test('drop-module: single iam-role node placed', async ({ page }) => {
    await gotoStory(page, 'flows-iamrole--default');
    // Exactly one node from the iam-role seed.
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    // The node's label should mention "role" — coarse, but catches
    // schema-shape regressions without pinning to an exact label.
    await expect(page.locator('.react-flow__node').first()).toContainText(/role/i);
  });

  test('composite-hierarchy: iam-stack fixture renders a collapsed composite', async ({ page }) => {
    await gotoStory(page, 'flows-iamstack--default');
    // Post composite preservation: iam-stack drops as ONE top-level
    // collapsed composite group. Its internal tree (iam_role leaf +
    // nested cloudwatch_logs_policy composite) lives inside and stays
    // hidden until the user expands the parent. Only the top-level
    // collapsed group is visible at canvas level.
    //
    // The group's data-group attribute carries the Terraform-sanitized
    // identifier (hyphens → underscores via ToTerraformIdentifier), not
    // the fixture name — so the selector is `iam_stack`, not `iam-stack`.
    await expect(page.locator('[data-group="iam_stack"][data-collapsed="true"]')).toHaveCount(1);
    // The collapsed composite carries its Interface as boundary pins —
    // every declared input (role_name, assume_role_policy, tags) plus
    // every declared output (role_name, role_arn, policy_arn). With
    // three inputs + three outputs rendered as aggregated pin rows,
    // the group has at least six Handle elements — a coarse-but-robust
    // proxy for "the Interface was carried end-to-end".
    const pinCount = await page.locator('[data-group="iam_stack"] .react-flow__handle').count();
    expect(pinCount).toBeGreaterThanOrEqual(6);
  });

  test('collapse-group: group renders collapsed', async ({ page }) => {
    await gotoStory(page, 'flows-collapsedgroup--default');
    // GroupNode tags its root div with `data-group` (= groupId) and
    // `data-collapsed` (= "true" | "false"). The collapsed-group fixture
    // has exactly one group in collapsed state.
    await expect(page.locator('[data-collapsed="true"]')).toHaveCount(1);
  });

  test('generate-flow: wired-stack fixture renders 3 pre-wired nodes', async ({ page }) => {
    await gotoStory(page, 'flows-wiredstack--default');
    // wired-stack seed: 3 leaf bundles + 2 cross-bundle wires (per Plan 1 Phase F fixtures).
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });
});
