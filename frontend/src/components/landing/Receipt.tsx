import { Amount } from "./Amount";
import { NayaPayLogo } from "./NayaPayLogo";
export function Receipt() { return (<div className="rcpt">
 <div className="av">K</div>
<div className="who">KAFI</div>
<div className="sub">Card payment &middot; 4821</div>
<div className="amt">Rs. <Amount value={850} /></div>
<div className="dt">3 Nov 2026, 04:12 PM</div>

 <div className="pn"><div><span>Amount</span><b>Rs. <Amount value={850} /></b></div>
<div><span>Service Fee (Incl. Tax)</span><b>Rs. <Amount value={0} /></b></div>
<hr /><div><span>Total Amount</span><b>Rs. <Amount value={850} /></b></div>
</div>

 <div className="sw">Paid with <NayaPayLogo /></div>
<span className="rtag">Food &amp; drink</span></div>
); }
