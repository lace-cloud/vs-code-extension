import { describe, expect, test, vi } from 'vitest';
import { createVscodeMock } from '../../../packages/chat-sidebar/src/__tests__/test-utils/vscode-mock';

vi.mock('vscode', () => createVscodeMock());

import { isTerminal, TERMINAL_RUN_STATUSES } from '../cli';

describe('isTerminal', () => {
  test('recognizes all terminal statuses', () => {
    for (const s of TERMINAL_RUN_STATUSES) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  test('non-terminal statuses return false', () => {
    for (const s of ['auto_apply', 'applying', 'awaiting_approval', 'plan_succeeded', '']) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  test('unknown status returns false', () => {
    expect(isTerminal('not_a_real_status')).toBe(false);
  });
});

describe('TERMINAL_RUN_STATUSES', () => {
  test('covers the apply+policy+cancel terminal states', () => {
    expect(TERMINAL_RUN_STATUSES.has('apply_succeeded')).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has('apply_failed')).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has('plan_failed')).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has('policy_blocked')).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has('cancelled')).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has('rejected')).toBe(true);
  });

  test('does not include in-flight states', () => {
    expect(TERMINAL_RUN_STATUSES.has('applying')).toBe(false);
    expect(TERMINAL_RUN_STATUSES.has('awaiting_approval')).toBe(false);
    expect(TERMINAL_RUN_STATUSES.has('plan_succeeded')).toBe(false);
  });
});
