import type { RegistryRow } from '../protocol/registry-protocol';

// What a module shows when its vendor has no logo.
export const FALLBACK_GLYPH = '\u{1F4E6}';

// A module's icon: its vendor's logo when it has one, else the glyph.
export function ModuleIcon({
  vendor,
  className,
}: {
  vendor: RegistryRow['vendor'];
  className: string;
}) {
  return (
    <div className={className}>
      {vendor?.logoUrl ? <img src={vendor.logoUrl} alt="" /> : FALLBACK_GLYPH}
    </div>
  );
}
