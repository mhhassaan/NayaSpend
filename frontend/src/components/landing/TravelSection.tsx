import { useEffect, useRef, useState } from "react";
import { inView, scroll } from "motion";
import { Traveller } from "./Traveller";
import { EmailCard } from "./EmailCard";
import { PlanCard } from "./PlanCard";
import { MonthCard } from "./MonthCard";

const states = [0, 0, 1, 2, 3, 4], y = [0, -120, 0, 0, -215, -215];
const beats = [
  { title: <><em>Clarity</em> follows.</>, copy: "It starts with the card you already use." },
  { title: <>You pay.<br />An email lands.</>, copy: "Every NayaPay purchase already sends you one. That is all NayaSpend needs." },
  { title: <>It becomes<br />a receipt.</>, copy: "Read-only Gmail access picks the email up and turns it into a clean record. Nothing to type." },
  { title: <>It finds<br />its category.</>, copy: "KAFI goes to Food & drink. Correct one once and it remembers." },
  { title: <>Your plan<br />keeps count.</>, copy: "Set a budget per category and see where the month stands." },
  { title: <>The month<br />takes shape.</>, copy: "Food, bills, groceries. The questions from the top of the page now have answers." },
];

export function TravelSection({ reduce }: { reduce: boolean }) {
  const section = useRef<HTMLElement>(null);
  const flyX = useRef<HTMLDivElement>(null);
  const flyY = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);
  const [plan, setPlan] = useState(false), [month, setMonth] = useState(false);
  useEffect(() => {
    const target = section.current;
    if (!target || reduce) return;
    const stopScroll = scroll((p: number) => {
      const a = Math.cos(Math.PI * p * 5), width = Math.min(window.innerWidth * .22, 290);
      if (flyX.current) flyX.current.style.transform = `translateX(${a * width}px) rotate(${a * 6}deg)`;
    }, { target, offset: ["start center", "end center"] });
    const stops = typeof IntersectionObserver === "undefined" ? [] : Array.from(target.querySelectorAll(".beat")).map((el, i) => inView(el, () => {
      setBeat(i);
      if (flyY.current) flyY.current.style.transform = `translateY(${y[i]}px)`;
      if (i === 4) setPlan(true);
      if (i === 5) setMonth(true);
      return () => { if (i === 4) setPlan(false); if (i === 5) setMonth(false); };
    }, { amount: .55 }));
    return () => { stopScroll(); stops.forEach(stop => stop()); };
  }, [reduce]);
  return <section ref={section} className="travel G3" aria-label="From card payment to spending clarity">
    {!reduce && <div className="fly"><div ref={flyX} className="flyx"><div ref={flyY} className="flyy"><Traveller state={states[beat]} tapped={beat === 1} /></div></div></div>}
    {beats.map(({ title, copy }, i) => <article key={i} className={`beat${i % 2 ? " flip" : ""}`}><div className="txt"><h2 className={`${i === 0 ? "big " : ""}rv`}>{title}</h2><p className="rv">{copy}</p></div><div className="vis rv" style={{ "--r": ["0deg", "-2deg", "0deg", "0deg", "1.5deg", "-1.5deg"][i] } as React.CSSProperties}>
      {i === 1 && <EmailCard />}{i === 4 && <PlanCard active={reduce || plan} />}{i === 5 && <MonthCard active={reduce || month} />}
    </div></article>)}
  </section>;
}
