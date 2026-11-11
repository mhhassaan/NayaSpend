import { Amount } from "./Amount";
import { TextMorph } from "torph/react";
import { useReducedMotion } from "motion/react";
export function PlanCard({ active = true }: { active?: boolean }) { const reduce = !!useReducedMotion(); return (<div className="card"><div className="top"><span className="ico"><svg viewBox="0 0 24 24"><path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 13l3.6-3.6"/></svg></span></div>
<h3>Food &amp; drink</h3>
  <div className="ringwrap"><svg className="ring" viewBox="0 0 36 36"><circle className="t" cx="18" cy="18" r="14.5" pathLength="100"/><circle className="p" style={{strokeDashoffset: active ? 38 : 100}} cx="18" cy="18" r="14.5" pathLength="100"/></svg>
  <div className="ringtxt"><div className="pct"><Amount value={active ? 62 : 0} /><small>%</small></div>
<div className="plan"><TextMorph duration={480} disabled={reduce}>{`${active ? "12,400" : "0"} of 20,000`}</TextMorph></div>
</div>
</div>
</div>
); }
