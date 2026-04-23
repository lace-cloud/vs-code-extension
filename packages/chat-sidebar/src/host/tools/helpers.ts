// src/chat/tools/helpers.ts
//
// Shared helpers for chat tool implementations.

import type { ToolResult } from '@lace-cloud/chat-core';
import type { Action, BundleApplyResult, LaceTransport } from '@lace-cloud/host';
import type { CanvasView } from '@lace-cloud/proto';

const ENGINE_NOT_RUNNING: ToolResult = {
  content:
    'Lace engine is not running. Ask the user to start it with **Lace: Start Engine** from the Command Palette, then retry.',
  isError: true,
};

/**
 * Guard: require a running engine. Returns the client or an error ToolResult.
 */
export function requireEngine(
  getRpcClient: () => LaceTransport | null,
): { client: LaceTransport } | { error: ToolResult } {
  const client = getRpcClient();
  if (!client) {
    return { error: ENGINE_NOT_RUNNING };
  }
  return { client };
}

/** Extract error message from unknown error. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Apply a single action through the single ApplyAction RPC. Post-P10 this
 * is the only mutation surface; per-method transport helpers no longer
 * exist. Returns the BundleApplyResult (success flag + validation errors).
 */
export async function applyAction(
  client: LaceTransport,
  action: Action,
): Promise<BundleApplyResult> {
  return client.applyAction([action]);
}

/**
 * Apply an action, then wait for the post-mutation BundleState to arrive
 * on the Subscribe stream (via ChatController.awaitNextView). Used by
 * tools that must observe the post-mutation view (e.g., placeModule
 * finding the new instance's id). The caller must wire `awaitNextView`
 * through deps; it's set up before the RPC so no event is missed.
 *
 * On mutation failure, the waiter is discarded and the call short-circuits
 * with `{ success: false, errors, view: null }` — there is no
 * post-mutation state to wait for.
 */
export async function applyActionAndAwaitView(
  client: LaceTransport,
  action: Action,
  awaitNextView: () => Promise<CanvasView | null>,
): Promise<{ result: BundleApplyResult; view: CanvasView | null }> {
  // Arm the waiter BEFORE sending the action — if we armed after, a
  // fast Subscribe broadcast could arrive before the waiter is in the
  // queue and we'd hang.
  const viewPromise = awaitNextView();
  const result = await applyAction(client, action);
  if (!result.success) {
    return { result, view: null };
  }
  const view = await viewPromise;
  return { result, view };
}

/** Format a BundleApplyResult's errors as a human-readable reason. */
export function applyReason(result: BundleApplyResult): string {
  if (result.success) return '';
  return result.errors.map((e) => e.message).join('; ') || 'unknown validation error';
}
