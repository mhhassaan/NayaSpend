import { Card } from "./Card";
import { Logo } from "./Logo";
import { StatDisplay } from "./StatDisplay";
import { formatCents } from "../utils/money";

export type SpendingRecapCardProps = {
  month: string;
  spentCents: number;
  byCategory: { category: string; totalCents: number }[];
  mode: "amounts" | "percentages";
};

export function SpendingRecapCard({ month, spentCents, byCategory, mode }: SpendingRecapCardProps) {
  const categories = [...byCategory].sort((a, b) => b.totalCents - a.totalCents);
  const top = categories.slice(0, 3);
  const otherCents = categories.slice(3).reduce((sum, item) => sum + item.totalCents, 0);
  const percentage = (cents: number) => spentCents > 0 ? Math.round(cents / spentCents * 100) : 0;
  const value = (cents: number) => mode === "amounts" ? formatCents(cents) : `${percentage(cents)}%`;
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const barColors = ["bg-electric-orange", "bg-vivid-violet", "bg-bubblegum"];

  return (
    <Card aria-label="Spending recap" className={`flex aspect-[9/16] min-h-[640px] w-full max-w-sm flex-col !bg-blackberry !p-0 overflow-hidden font-body text-hyper-white ${mode === "percentages" ? "ring-2 ring-vivid-violet" : ""}`}>
      <header className="bg-hyper-white px-6 py-5">
        <Logo />
      </header>
      <div className="flex flex-1 flex-col gap-6 px-6 py-7">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bubblegum">{monthLabel} / My spending recap</p>
          <h2 className="mt-3 font-display text-[30px] font-bold leading-tight tracking-tight">A month.<br /> A little more clarity.</h2>
        </div>
        <div className={`[&>div>span]:text-lightest-grey ${mode === "percentages" ? "[&>div>span:last-child]:text-vivid-violet" : "[&>div>span:last-child]:text-hyper-white"}`}>
          <StatDisplay label={mode === "amounts" ? "Total spent" : "My spending, in perspective"} value={value(spentCents)} />
          <p className="mt-2 text-[13px] text-lightest-grey">{mode === "amounts" ? "A little here. A little there. All here." : "The whole month. Just the pattern."}</p>
        </div>
        <div>
          <ol className="flex flex-col gap-4" aria-label="Top spending categories">
            {top.map((item, index) => (
              <li key={item.category}>
                <div className="mb-2 flex items-start justify-between gap-3 text-[13px]">
                  <span className="min-w-0 break-words">{String(index + 1).padStart(2, "0")} / {item.category}</span>
                  <strong className="shrink-0">{value(item.totalCents)}</strong>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-deep-grey/40">
                  <div className={`h-full rounded-full ${barColors[index]}`} style={{ width: `${Math.max(0, Math.min(100, percentage(item.totalCents)))}%` }} />
                </div>
              </li>
            ))}
          </ol>
          {categories.length > 3 && <p className="mt-4 text-[12px] text-lightest-grey">{value(otherCents)} across other categories</p>}
        </div>
        {top[0] && (
          <div className="mt-auto pt-2">
            <p className="break-words font-display text-[21px] font-semibold leading-tight text-bubblegum">{top[0].category} took the lead this month.</p>
            {top[0].category === "Food & Dining" && <p className="mt-3 text-[12px] text-lightest-grey">Good food had a place in the story.</p>}
          </div>
        )}
      </div>
      <div className="flex justify-between gap-3 border-t border-deep-grey/40 px-6 py-4 text-[11px] text-lightest-grey">
        <span>My month, made clearer.</span><span>nayaspend</span>
      </div>
    </Card>
  );
}

