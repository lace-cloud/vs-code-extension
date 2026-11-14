import type { RegistryRow } from '../protocol/registry-protocol';

// What a module shows when its author has no logo.
export const FALLBACK_GLYPH = '\u{1F4E6}';

// A module's icon: its author's logo when it has one, else the glyph. It is
// decoration beside the module's name, so a screen reader skips it, and a
// span, so it can sit inside the button that opens the module.
export function ModuleIcon({
  author,
  className,
}: {
  author: RegistryRow['authorProfile'];
  className: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      {author?.logoUrl ? <img src={author.logoUrl} alt="" /> : FALLBACK_GLYPH}
    </span>
  );
}
