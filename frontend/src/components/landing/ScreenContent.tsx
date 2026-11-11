import type { CSSProperties } from "react";
import { Amount } from "./Amount";
import { Spark } from "./Spark";
import { ScreenTabs } from "./ScreenTabs";

function Dash() { return (<div className="card"><div className="hd"><span className="me">H</span><span className="hbtn"><svg viewBox="0 0 24 24"><path d="M12 4v10M8 11l4 4 4-4M5 20h14"/></svg></span></div>
<div className="ctr"><small>Spent this month</small><div className="bal">Rs. <Amount value={42180} /></div>
<span className="mon">November 2026</span></div>

  <div className="io"><span>Planned<b>Rs. <Amount value={61000} /></b></span><span>Left to spend<b>Rs. <Amount value={18820} /></b></span></div>

  <div className="sheet"><div className="lab">Where it went</div>
<div className="trow"><span className="ic gr"><svg viewBox="0 0 24 24"><path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 9V7M10 7h4"/></svg></span><span className="nm">Food &amp; drink<small>14 purchases</small></span><span className="am w">Rs. <Amount value={12400} /><small><Amount value={62} />% of plan</small></span></div>
<div className="trow"><span className="ic "><svg viewBox="0 0 24 24"><path d="M13 2L5 14h6l-1 8 8-12h-6z"/></svg></span><span className="nm">Bills &amp; utilities<small>4 payments</small></span><span className="am w">Rs. <Amount value={9800} /><small><Amount value={68} />% of plan</small></span></div>
<div className="trow"><span className="ic "><svg viewBox="0 0 24 24"><rect x="7.5" y="4.5" width="9" height="15" rx="2" fill="#fff" stroke="none"/><path d="M12 4.5v15" stroke="#ff5a1f" strokeWidth="1.7"/></svg></span><span className="nm">Groceries<small>9 purchases</small></span><span className="am w">Rs. <Amount value={15300} /><small><Amount value={61} />% of plan</small></span></div>
</div>
<ScreenTabs active={0} />
</div>
); }
function Budgets() { return (<div className="card"><div className="hd"><span className="me">H</span><span className="hbtn"><svg viewBox="0 0 24 24"><path d="M12 4v10M8 11l4 4 4-4M5 20h14"/></svg></span></div>
<div className="ctr"><small>Budgets</small><div className="bal"><Amount value={62} /><span style={{"fontSize":".5em"} as CSSProperties}>% used</span></div>
</div>

  <div className="lim "><div className="t"><span>Food &amp; drink</span><span><Amount value={62} />%</span></div>
<div className="v"><span>Rs. <Amount value={12400} /></span><span>Rs. <Amount value={20000} /></span></div>
<div className="bbar"><i style={{"--w":"0.62"} as CSSProperties}></i></div>
</div>
<div className="lim "><div className="t"><span>Utilities</span><span><Amount value={68} />%</span></div>
<div className="v"><span>Rs. <Amount value={8200} /></span><span>Rs. <Amount value={12000} /></span></div>
<div className="bbar"><i style={{"--w":"0.68"} as CSSProperties}></i></div>
</div>
<div className="lim hot"><div className="t"><span>Groceries</span><span><Amount value={92} />%</span></div>
<div className="v"><span>Rs. <Amount value={23100} /></span><span>Rs. <Amount value={25000} /></span></div>
<div className="bbar"><i style={{"--w":"0.92"} as CSSProperties}></i></div>
</div>
<div className="lim "><div className="t"><span>Transport</span><span><Amount value={34} />%</span></div>
<div className="v"><span>Rs. <Amount value={3400} /></span><span>Rs. <Amount value={10000} /></span></div>
<div className="bbar"><i style={{"--w":"0.34"} as CSSProperties}></i></div>
</div>
<ScreenTabs active={1} />
</div>
); }
function Bills() { return (<div className="card"><div className="hd"><span className="me">H</span><span className="hbtn"><svg viewBox="0 0 24 24"><path d="M12 4v10M8 11l4 4 4-4M5 20h14"/></svg></span></div>
<div className="ctr"><small>Due this month</small><div className="bal">Rs. <Amount value={15149} /></div>
<span className="mon">3 bills</span></div>

  <div className="sheet"><div className="lab">Next 7 days</div>
<div className="trow"><span className="ic "><svg viewBox="0 0 24 24"><path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0"/></svg></span><span className="nm">PTCL broadband<small>Due 15 Nov</small></span><span className="am w">Rs. <Amount value={3499} /><small>in 4 days</small></span></div>
<div className="lab">Later</div>
<div className="trow"><span className="ic v"><svg viewBox="0 0 24 24"><path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0"/></svg></span><span className="nm">Nayatel<small>Due 20 Nov</small></span><span className="am w">Rs. <Amount value={2750} /><small>in 9 days</small></span></div>
<div className="trow"><span className="ic p"><svg viewBox="0 0 24 24"><path d="M13 2L5 14h6l-1 8 8-12h-6z"/></svg></span><span className="nm">K-Electric<small>Due 24 Nov</small></span><span className="am w">Rs. <Amount value={8900} /><small>in 13 days</small></span></div>
</div>

  <div className="pillrow"><span className="pl o">Reminder set for 14 Nov</span></div>
<ScreenTabs active={2} />
</div>
); }
function Trends() { return (<div className="card"><div className="hd"><span className="me">H</span><span className="hbtn"><svg viewBox="0 0 24 24"><path d="M12 4v10M8 11l4 4 4-4M5 20h14"/></svg></span></div>
<div className="ctr"><small>November so far</small><div className="bal">Rs. <Amount value={42180} /></div>
<span className="mon"><Amount value={8} />% under October</span></div>
<Spark />
  <div className="io"><span>Top category<b>Groceries</b></span><span>Biggest day<b>9 Nov</b></span></div>

  <div className="sheet" style={{"flex":"none"} as CSSProperties}><div className="lab">9 November</div>
<div className="trow"><span className="ic "><svg viewBox="0 0 24 24"><rect x="7.5" y="4.5" width="9" height="15" rx="2" fill="#fff" stroke="none"/><path d="M12 4.5v15" stroke="#ff5a1f" strokeWidth="1.7"/></svg></span><span className="nm">Al-Fatah Mart<small>Groceries</small></span><span className="am ">- Rs. <Amount value={2140} /></span></div>
<div className="trow"><span className="ic gr"><svg viewBox="0 0 24 24"><path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 9V7M10 7h4"/></svg></span><span className="nm">KAFI<small>Food &amp; drink</small></span><span className="am ">- Rs. <Amount value={850} /></span></div>
</div>
<ScreenTabs active={3} />
</div>
); }
function Csv() { return (<div className="card"><div className="hd"><span className="me">H</span><span className="hbtn"><svg viewBox="0 0 24 24"><path d="M12 4v10M8 11l4 4 4-4M5 20h14"/></svg></span></div>
<div className="sheet" style={{"flex":"none"} as CSSProperties}><div className="trow"><span className="ic v"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v4h4"/></svg></span><span className="nm">NayaPay-statement-Oct.csv<small>126 rows</small></span><span className="am w">Imported<small>just now</small></span></div>
</div>

  <div className="sheet" style={{"flex":"none"} as CSSProperties}><div className="ck"><i>&#10003;</i>123 new transactions added</div>
<div className="ck"><i>&#10003;</i>Categories applied from your rules</div>
<div className="ck"><i style={{"background":"#ffb69c","color":"#5a2410"} as CSSProperties}>3</i>possible duplicates to review</div>
</div>

  <div className="sheet"><div className="lab">Possible duplicate</div>
<div className="dup"><div><b>KAFI</b>Rs. <Amount value={850} /> &middot; email</div>
<span>same?</span><div><b>KAFI</b>Rs. <Amount value={850} /> &middot; CSV</div>
</div>
<div className="pillrow" style={{"marginTop":"10px"} as CSSProperties}><span className="pl o">Keep once</span><span className="pl">Keep both</span></div>
</div>
<ScreenTabs active={3} />
</div>
); }
export const screenContent = { dash: Dash, budgets: Budgets, bills: Bills, trends: Trends, csv: Csv };
export type ScreenName = keyof typeof screenContent;
