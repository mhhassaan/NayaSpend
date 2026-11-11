import { NayaPayLogo } from "./NayaPayLogo";
const icons = [<NayaPayLogo symbol tone="current" />,
<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>,
<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/></svg>,
<svg viewBox="0 0 24 24"><path d="M4 9h14l-4-4M20 15H6l4 4"/></svg>];
export function ScreenTabs({active}: {active: number}) { return <div className="tabs" aria-hidden="true">{icons.map((icon, i) => <i key={i} className={i === active ? "on" : undefined}>{icon}</i>)}</div>; }
