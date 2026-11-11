import { Amount } from "./Amount";
import { NayaPayLogo } from "./NayaPayLogo";
export function EmailCard() { return (<div className="card"><div className="top"><span className="ico"><svg viewBox="0 0 24 24"><path d="M3 6.5h18v11H3z"/><path d="M3.6 7.2l8.4 6.3 8.4-6.3"/></svg></span><span className="live"><i></i>Live</span></div>
<h3>Email arrives</h3>
  <div className="note"><div className="av"><NayaPayLogo symbol tone="orange" /></div>
<div><small>NayaPay &middot; now</small><b>Rs. <Amount value={850} /></b><span>spent at KAFI</span></div>
</div>
</div>
); }
