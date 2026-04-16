/**
 * Canvas golden-path tests — Plan 2 Phase F.
 *
 * One test per flow story. Each navigates to Storybook's iframe URL for
 * the story, waits for the `[data-flow-ready]` marker the FlowDecorator
 * renders once boot completes (TestSessionOpen + Subscribe + initial
 * StateUpdated), asserts a small shape-level DOM invariant, and captures
 * a screenshot baseline.
 *
 * Baselines are CI-only (see playwright.config.ts `snapshotPathTemplate`).
 * Mac devs iterating locally see `-darwin.png` artefacts in __snapshots__/
 * — those are gitignored, not committed, not authoritative.
 *
 * `drift-badge` is intentionally absent: lace-cli's `pb.RenderNode` has no
 * drift metadata yet. Followup once the proto extends.
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
    await expect(page).toHaveScreenshot('empty-state.png');
  });

  test('drop-module: single iam-role node placed', async ({ page }) => {
    await gotoStory(page, 'flows-iamrole--default');
    // Exactly one node from the iam-role seed.
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    // The node's label should mention "role" — coarse, but catches
    // schema-shape regressions without pinning to an exact label.
    await expect(page.locator('.react-flow__node').first()).toContainText(/role/i);
    await expect(page).toHaveScreenshot('drop-module.png');
  });

  test('composite-hierarchy: iam-stack fixture renders a collapsed composite', async ({ page }) => {
    await gotoStory(page, 'flows-iamstack--default');
    // Post composite preservation: iam-stack drops as ONE top-level
    // collapsed composite group. Its internal tree (iam_role leaf +
    // nested cloudwatch_logs_policy composite) lives inside and stays
    // hidden until the user expands the parent. Only the top-level
    // collapsed group is visible at canvas level.
    await expect(page.locator('[data-group="iam-stack"][data-collapsed="true"]')).toHaveCount(1);
    // The collapsed composite carries its Interface as boundary pins —
    // every declared input (role_name, assume_role_policy, tags) plus
    // every declared output (role_name, role_arn, policy_arn). With
    // three inputs + three outputs rendered as aggregated pin rows,
    // the group has at least six Handle elements — a coarse-but-robust
    // proxy for "the Interface was carried end-to-end".
    const pinCount = await page.locator('[data-group="iam-stack"] .react-flow__handle').count();
    expect(pinCount).toBeGreaterThanOrEqual(6);
    await expect(page).toHaveScreenshot('composite-hierarchy.png');
  });

  test('collapse-group: group renders collapsed', async ({ page }) => {
    await gotoStory(page, 'flows-collapsedgroup--default');
    // GroupNode tags its root div with `data-group` (= groupId) and
    // `data-collapsed` (= "true" | "false"). The collapsed-group fixture
    // has exactly one group in collapsed state.
    await expect(page.locator('[data-collapsed="true"]')).toHaveCount(1);
    await expect(page).toHaveScreenshot('collapse-group.png');
  });

  test('generate-flow: wired-stack fixture renders 3 pre-wired nodes', async ({ page }) => {
    await gotoStory(page, 'flows-wiredstack--default');
    // wired-stack seed: 3 leaf bundles + 2 cross-bundle wires (per Plan 1 Phase F fixtures).
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    // Baseline screenshot of the wired stack BEFORE any generate click —
    // post-generate state has transient toasts that are harder to snapshot
    // deterministically. Clicking generate lives in a followup interaction test.
    await expect(page).toHaveScreenshot('generate-flow.png');
  });
});
