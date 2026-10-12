// The registry sidebar's categories to filter by, each a toggle that says
// whether it is chosen.
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
      {categories.map((category) => (
        <button
          type="button"
          key={category}
          className={`chip${chosen.includes(category) ? ' active' : ''}`}
          aria-pressed={chosen.includes(category)}
          onClick={() => onToggle(category)}
        >
          {category}
        </button>
      ))}
    </div>
  );
}
