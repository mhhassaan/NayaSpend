import { useEffect, useRef, type CSSProperties } from "react";
import { inView, scroll } from "motion";

export function Finale({ reduce }: { reduce: boolean }) {
  const section = useRef<HTMLDivElement>(null), close = useRef<HTMLElement>(null), button = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (reduce || !section.current || !close.current) return;
    const stopScroll = scroll((p: number) => section.current?.style.setProperty("--p", String(p)), { target: section.current, offset: ["start end", "start 30%"] });
    let first: ReturnType<typeof setTimeout> | undefined, loop: ReturnType<typeof setInterval> | undefined;
    let animation: Animation | undefined;
    const shake = () => {
      if (document.hidden || !button.current?.animate) return;
      animation?.cancel();
      animation = button.current.animate([
        { translate: "0 0", rotate: "0deg" }, { translate: "-9px 0", rotate: "-2deg" },
        { translate: "8px 0", rotate: "2deg" }, { translate: "-6px 0", rotate: "-1deg" },
        { translate: "4px 0", rotate: "1deg" }, { translate: "0 0", rotate: "0deg" },
      ], { duration: 650, easing: "cubic-bezier(.36,.07,.19,.97)" });
    };
    const clear = () => { clearTimeout(first); clearInterval(loop); animation?.cancel(); };
    const stopView = typeof IntersectionObserver === "undefined" ? () => {} : inView(close.current, () => {
      clear(); first = setTimeout(shake, 600); loop = setInterval(shake, 3600);
      return clear;
    }, { amount: .7 });
    return () => { stopScroll(); stopView(); clear(); };
  }, [reduce]);
  return <div ref={section} className="finale" id="start" style={{ "--p": reduce ? 1 : 0 } as CSSProperties}><div className="finale-card"><section ref={close} className="close" aria-labelledby="closing-title">
    <h2 className="rv" id="closing-title">Make sense of<br />your spending.</h2><p className="rv">Read-only Gmail access. You stay in control of your inbox.</p><a ref={button} className="btn rv" href="/login">Sign in with Google</a>
    <footer><span>NayaSpend. Independent spending companion. Not affiliated with NayaPay.</span><span>Amounts shown are illustrative.</span><div className="footer-links"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="#top">Back to top</a></div></footer>
  </section></div></div>;
}
