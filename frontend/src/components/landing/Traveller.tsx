import { NayaPayCard } from "./NayaPayCard";
import { Receipt } from "./Receipt";

export function Traveller({ state, tapped }: { state: number; tapped: boolean }) {
  return <div className="trav" data-s={state} aria-hidden="true"><div className="lay tc"><NayaPayCard tapped={tapped} /></div><div className="lay tr"><Receipt /></div></div>;
}
