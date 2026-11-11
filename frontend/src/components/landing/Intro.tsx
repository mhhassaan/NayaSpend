import { useEffect, useState } from "react";
import { AppScreens } from "./AppScreens";
import { NayaPayCard } from "./NayaPayCard";
import { TransactionRow } from "./TransactionRow";

export function Intro({ reduce }: { reduce: boolean }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => { if (!document.hidden) setActive(value => (value + 1) % 4); }, 5200);
    return () => clearInterval(timer);
  }, [reduce]);
  return <section className="hero intro" id="hero" aria-labelledby="intro-title"><div className="hpin"><div className="g">
    <div><h1 className="pre" id="intro-title">Know <em>where</em> your NayaPay money went.</h1>
      <p className="lead pre">NayaSpend reads your NayaPay transaction emails and turns them into categories, budgets and trends. Read-only. Nothing to type.</p>
      <div className="acts pre"><a className="btn" href="#story">Take a look</a><a className="btn s" href="/login">Get started</a></div>
    </div>
    <div className="heroart pre"><AppScreens names={["dash", "budgets", "bills", "trends"]} active={reduce ? 0 : active} /><div className="hcard float"><NayaPayCard interactive reduce={reduce} /></div><div className="hrow float b"><TransactionRow /><span className="tag">Food &amp; drink</span></div></div>
  </div></div></section>;
}
