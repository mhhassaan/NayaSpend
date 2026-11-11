import { useEffect, useRef } from "react";
import { scroll } from "motion";

const snippets = ["You spent Rs. 850 at KAFI", "Rs. 3,499 paid to PTCL", "You spent Rs. 2,140 at Al-Fatah", "Rs. 1,200 at Dr. Ahmed Clinic", "You spent Rs. 640 at Careem", "Rs. 8,900 paid to K-Electric", "You spent Rs. 450 at KAFI", "Rs. 2,750 paid to Nayatel"];
const left = [58, 74, 8, 66, 30, 82, 46, 14], top = [10, 30, 52, 62, 78, 84, 20, 88];
const rotation = [-6, 5, -3, 7, -8, 4, 3, -5], opacity = [.5, .35, .3, .45, .3, .4, .25, .35];
const blur = [0, 1, 2, .5, 2, 1, 2.5, 1.5], drift = [60, -40, 90, -70, 50, -90, 120, -30];

export function ProblemSection({ reduce }: { reduce: boolean }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reduce || !section.current) return;
    const bits = section.current.querySelectorAll<HTMLElement>(".pile span");
    return scroll((p: number) => bits.forEach((bit, i) => { bit.style.transform = `translateY(${(p - .5) * drift[i]}px)`; }), { target: section.current, offset: ["start end", "end start"] });
  }, [reduce]);
  return <section ref={section} className="prob" id="story" aria-labelledby="problem-title">
    {!reduce && <div className="pile" aria-hidden="true">{snippets.map((text, i) => <span key={text} style={{ left: `${left[i]}%`, top: `${top[i]}%`, rotate: `${rotation[i]}deg`, opacity: opacity[i], filter: `blur(${blur[i]}px)` }}>{text}</span>)}</div>}
    <div className="in"><h2 className="big rv" id="problem-title">Spending happens.</h2><p className="lead rv">A coffee here, a bill there. By the 25th you know the money is gone. You just can't say where.</p>
      <div className="qs">{[["How much went to food?", "Rs. 12,400", "Can't remember"], ["How much went to bills?", "Rs. 9,800", "Somewhere in the inbox"], ["And groceries?", "Rs. 15,300", "No idea"]].map(([question, amount, caption]) => <article className="q rv" key={question}><span>{question}</span><b aria-hidden="true">{amount}</b><em>{caption}</em></article>)}</div>
    </div>
  </section>;
}
