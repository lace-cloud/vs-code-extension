import { describe, expect, test } from 'vitest';
import type * as vscode from 'vscode';
import { canvasHtml, pageHtml } from '../webview-html';

const inputs = {
  outUri: (file: string) => `webview://out/${file}` as unknown as vscode.Uri,
  cspSource: 'vscode-webview://csp',
  title: 'acme <vpc>',
};

const scripts = (html: string) => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];

describe('a webview page', () => {
  test("runs one script, its bundle's, by this document's nonce, and no inline script", () => {
    const html = pageHtml(inputs, { bundle: 'registry-sidebar', images: ['https:'] });
    const [nonce] = html.match(/'nonce-([0-9a-f]+)'/)?.slice(1) ?? [];
    expect(scripts(html)).toEqual([
      expect.arrayContaining([` nonce="${nonce}" src="webview://out/registry-sidebar.js"`, '']),
    ]);
    expect(html).toContain('href="webview://out/registry-sidebar.css"');
  });

  test('loads images from the sources it names beside its own', () => {
    expect(pageHtml(inputs, { bundle: 'module-detail', images: ['https:', 'data:'] })).toContain(
      'img-src vscode-webview://csp https: data:',
    );
    expect(canvasHtml(inputs)).toContain('img-src vscode-webview://csp data:;');
  });

  test('escapes its title', () => {
    expect(pageHtml(inputs, { bundle: 'b', images: [] })).toContain(
      '<title>acme &#60;vpc&#62;</title>',
    );
  });

  test('is new each time: a fresh nonce', () => {
    expect(canvasHtml(inputs)).not.toBe(canvasHtml(inputs));
  });
});
