// @vitest-environment happy-dom
import React from 'react';
import { test, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import PanelFrame from '../components/PanelFrame';

afterEach(cleanup);

// ── Rendering ──

test('PanelFrame renders string title in an h3', () => {
  const { container } = render(
    <PanelFrame title="Settings" onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  const heading = container.querySelector('h3');
  expect(heading).not.toBeNull();
  expect(heading!.textContent).toBe('Settings');
});

test('PanelFrame renders ReactNode title as-is (no h3 wrapper)', () => {
  const { container } = render(
    <PanelFrame title={<div data-testid="custom-title">Custom</div>} onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  expect(container.querySelector('[data-testid="custom-title"]')).not.toBeNull();
  expect(container.querySelector('h3')).toBeNull();
});

test('PanelFrame renders children', () => {
  const { container } = render(
    <PanelFrame title="Test" onClose={() => {}}>
      <div data-testid="child">Hello</div>
    </PanelFrame>,
  );
  const child = container.querySelector('[data-testid="child"]');
  expect(child).not.toBeNull();
  expect(child!.textContent).toBe('Hello');
});

// ── Close button ──

test('PanelFrame close button calls onClose', () => {
  const onClose = vi.fn();
  const { container } = render(
    <PanelFrame title="Test" onClose={onClose}>
      <p>body</p>
    </PanelFrame>,
  );
  const closeBtn = container.querySelector('button[aria-label="Close"]');
  expect(closeBtn).not.toBeNull();
  fireEvent.click(closeBtn!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

// ── Footer ──

test('PanelFrame renders footer when provided', () => {
  const { container } = render(
    <PanelFrame
      title="Test"
      footer={<button data-testid="save-btn">Save</button>}
      onClose={() => {}}
    >
      <p>body</p>
    </PanelFrame>,
  );
  expect(container.querySelector('[data-testid="save-btn"]')).not.toBeNull();
  expect(container.querySelector('footer')).not.toBeNull();
});

test('PanelFrame omits footer element when no footer prop', () => {
  const { container } = render(
    <PanelFrame title="Test" onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  expect(container.querySelector('footer')).toBeNull();
});

// ── Scrollable ──

test('PanelFrame body has padding classes when scrollable (default)', () => {
  const { container } = render(
    <PanelFrame title="Test" onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  const body = container.querySelector('header')!.nextElementSibling as HTMLElement;
  expect(body.className).toContain('p-4');
  expect(body.className).toContain('pb-24');
});

test('PanelFrame body has no padding when scrollable=false', () => {
  const { container } = render(
    <PanelFrame title="Test" scrollable={false} onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  const body = container.querySelector('header')!.nextElementSibling as HTMLElement;
  expect(body.className).not.toContain('p-4');
  expect(body.className).not.toContain('pb-24');
});

// ── Width ──

test('PanelFrame uses default width 420', () => {
  const { container } = render(
    <PanelFrame title="Test" onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.style.width).toBe('420px');
});

test('PanelFrame uses custom width', () => {
  const { container } = render(
    <PanelFrame title="Test" width={460} onClose={() => {}}>
      <p>body</p>
    </PanelFrame>,
  );
  const root = container.firstElementChild as HTMLElement;
  expect(root.style.width).toBe('460px');
});
