import { useEffect, useRef, useState } from "react";
import { animate, spring } from "motion";
import { TextMorph } from "torph/react";
import { NayaPayLogo } from "./NayaPayLogo";

export function NayaPayCard({ interactive = false, reduce = false, tapped = false }: { interactive?: boolean; reduce?: boolean; tapped?: boolean }) {
  const [flipped, setFlipped] = useState(false);
  const tilt = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!interactive || reduce || !tilt.current) return;
    const entry = animate(tilt.current, { rotateY: [-75, 0] }, { type: spring, duration: 1.1, bounce: .2, delay: .7 });
    let loop: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      if (!document.hidden) setFlipped(value => !value);
      loop = setInterval(() => { if (!document.hidden) setFlipped(value => !value); }, 6500);
    }, 4200);
    return () => { entry.stop(); clearTimeout(first); clearInterval(loop); };
  }, [interactive, reduce]);
  useEffect(() => {
    if (!tilt.current || reduce || !interactive) return;
    // Leave the initial turn to the entry animation.
    if (!flipped && !tilt.current.dataset.turned) return;
    tilt.current.dataset.turned = "true";
    const animation = animate(tilt.current, { rotateY: flipped ? 180 : 0 }, { type: spring, duration: .95, bounce: .18 });
    return () => animation.stop();
  }, [flipped, interactive, reduce]);
  useEffect(() => {
    if (!tapped || reduce || !shell.current) return;
    const face = shell.current.querySelector<HTMLElement>(".np-face")!;
    const pulse = shell.current.querySelector<HTMLElement>(".np-pulse")!;
    const pill = shell.current.querySelector<HTMLElement>(".np-tap")!;
    const animations = [
      animate(face, { transform: ["scale(1)", "scale(.972)", "scale(1)"] }, { duration: .34, ease: [.23, 1, .32, 1] }),
      animate(pulse, { opacity: [.9, 0], transform: ["scale(1)", "scale(1.07)"] }, { duration: .7, ease: [.23, 1, .32, 1] }),
      animate(pill, { opacity: [0, 1, 1, 0], transform: ["translate(-50%,10px) scale(.9)", "translate(-50%,0) scale(1)", "translate(-50%,0) scale(1)", "translate(-50%,-8px) scale(1)"] }, { duration: 2.2, times: [0, .12, .78, 1], ease: "easeOut" }),
    ];
    return () => animations.forEach(animation => animation.stop());
  }, [tapped, reduce]);
  const faces = <div ref={tilt} className="np-tilt" style={reduce ? { transform: flipped ? "rotateY(180deg)" : undefined } : undefined}>
    <div className="np-face" aria-hidden={flipped}><span className="np-glare" /><div className="np-chip" /><NayaPayLogo symbol /><span className="np-name">HASSAN</span><span className="np-last">4821</span><span className="np-visa">VISA</span></div>
    <div className="np-back" aria-hidden={!flipped}><i className="strip" /><div className="sig">Hassan</div><div className="cvv"><span>CVV</span><span>•••</span></div><div className="acts2">
      <span><i><svg viewBox="0 0 24 24"><path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" /></svg></i>Freeze</span>
      <span><i><svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></svg></i>Reveal</span>
      <span><i><svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" /></svg></i>More</span>
    </div></div><i className="np-pulse" /><span className="np-tap"><TextMorph duration={480} disabled={reduce}>−Rs. 850 · KAFI</TextMorph></span>
  </div>;
  return <div ref={shell} className="np">{interactive ? <button className="np-button" type="button" aria-label="Flip NayaPay card" aria-pressed={flipped} onClick={() => setFlipped(value => !value)}>{faces}</button> : faces}</div>;
}
