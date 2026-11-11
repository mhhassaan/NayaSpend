import { useEffect, useRef, useState } from "react";
import { scroll } from "motion";
import { AppScreens } from "./AppScreens";

const steps = [
  ["Budgets that count themselves.", "Set a limit per category. Every captured purchase moves the bar."],
  ["Bills stay on your radar.", "Reminders for dues like PTCL and Nayatel before they are late."],
  ["Trends across the month.", "Step back from single purchases and see the pattern."],
  ["Older months too.", "Import a NayaPay CSV statement. Possible duplicates are flagged for you to review."],
];
export function TourSection({ reduce }: { reduce: boolean }) {
  const section = useRef<HTMLElement>(null), rail = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduce || !section.current) return;
    return scroll((p: number) => {
      setActive(Math.min(3, Math.floor(p * 4)));
      if (rail.current) rail.current.style.transform = `scaleY(${p})`;
    }, { target: section.current, offset: ["start start", "end end"] });
  }, [reduce]);
  const current = reduce ? 3 : active;
  return <section ref={section} className="pinsec tour" id="experience" aria-label="Explore NayaSpend"><div className="pin"><i className="rail" aria-hidden="true"><b ref={rail} /></i><div className="grid"><div className="stage"><AppScreens names={["budgets", "bills", "trends", "csv"]} active={current} /></div>
    <ol className="steps">{steps.map(([title, copy], i) => <li key={title} className={current === i ? "act" : undefined} aria-current={current === i ? "step" : undefined}><h3>{title}</h3><p>{copy}</p></li>)}</ol>
  </div></div></section>;
}
