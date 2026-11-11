import { Amount } from "./Amount";
export function TransactionRow() { return (<div className="trow"><span className="ic gr"><svg viewBox="0 0 24 24"><path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 9V7M10 7h4"/></svg></span><span className="nm">KAFI<small>Card payment · 4821</small></span><span className="am ">- Rs. <Amount value={850} /></span></div>
); }
