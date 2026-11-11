import { CANONICAL_CATEGORIES } from "../../../shared/categories";
export { CANONICAL_CATEGORIES } from "../../../shared/categories";

type CategorySelectProps = {
  value: string;
  onChange: (category: string) => void;
  id?: string;
  "aria-label"?: string;
  extraCategories?: string[];
};

export function CategorySelect({ value, onChange, id, "aria-label": ariaLabel, extraCategories = [] }: CategorySelectProps) {
  const extras = [...new Set(extraCategories)].filter(category => !CANONICAL_CATEGORIES.includes(category)).sort((a, b) => a.localeCompare(b));
  return (
    <select id={id} aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-sm border border-mid-grey px-3 py-2">
      {[...CANONICAL_CATEGORIES, ...extras].map(category => <option key={category} value={category}>{category}</option>)}
    </select>
  );
}
