// The registry sidebar's categories to filter by, each a toggle that says
// whether it is chosen (aria-pressed). A chosen chip leads with a check mark,
// so chosen and not differ by shape as well as colour; the mark is hidden
// from screen readers, which hear the pressed state.
export function CategoryChips({
  categories,
  chosen,
  onToggle,
}: {
  categories: readonly string[];
  chosen: readonly string[];
  onToggle: (category: string) => void;
}) {
  return (
    <div id="chips">
      {categories.map((category) => {
        const on = chosen.includes(category);
        return (
          <button
            type="button"
            key={category}
            className={`chip${on ? ' active' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(category)}
          >
            {on && (
              <span className="chip-check" aria-hidden="true">
                {'✓'}
              </span>
            )}
            {category}
          </button>
        );
      })}
    </div>
  );
}
