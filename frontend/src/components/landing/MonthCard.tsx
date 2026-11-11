import { Amount } from "./Amount";
import { Spark } from "./Spark";
export function MonthCard({ active = true }: { active?: boolean }) { return (<div className="card"><div className="top"><span className="ico"><svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 3 8-9"/><path d="M15 6h5v5"/></svg></span></div>
<h3>November so far</h3><div className="tot"><small>Rs.</small><Amount value={active ? 42180 : 0} /></div>
<Spark active={active} /></div>
); }
