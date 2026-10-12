import type { RegistryRow } from '../protocol/registry-protocol';

// What a module shows when its vendor has no logo.
export const FALLBACK_GLYPH = '\u{1F4E6}';

// A module's icon: its vendor's logo when it has one, else the glyph. It is
// decoration beside the module's name, so a screen reader skips it, and a
// span, so it can sit inside the button that opens the module.
export function ModuleIcon({
  vendor,
  className,
}: {
  vendor: RegistryRow['vendor'];
  className: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      {vendor?.logoUrl ? <img src={vendor.logoUrl} alt="" /> : FALLBACK_GLYPH}
    </span>
  );
}
