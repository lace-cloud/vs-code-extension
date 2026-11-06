// What the stylesheet tests read of a stylesheet's text: each rule's selectors
// and declarations, no further, since how they draw is the browser's.
export type Rule = { selectors: string; declarations: string };

// The rules of `css`, comments dropped, whitespace collapsed.
export const rulesOf = (css: string): Rule[] =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((rule) => rule.split('{'))
    .map(([selectors = '', declarations = '']) => ({
      selectors: selectors.trim(),
      declarations: declarations.replace(/\s+/g, ' ').trim(),
    }));

// The VS Code colours the rules naming `part` declare.
export const coloursOf = (rules: readonly Rule[], part: RegExp): string[] =>
  rules
    .filter(({ selectors }) => part.test(selectors))
    .flatMap(({ declarations }) => [...declarations.matchAll(/--vscode-[\w-]+/g)])
    .map(([token]) => token);
