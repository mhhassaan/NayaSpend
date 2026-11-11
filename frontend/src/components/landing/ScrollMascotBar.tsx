import { useEffect, useRef, type RefObject } from "react";
import type Lenis from "lenis";
import { Mascot } from "./Mascot";

export function ScrollMascotBar({ reduce, lenis }: { reduce: boolean; lenis: RefObject<Lenis | null> }) {
  const bar = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  useEffect(() => {
    const target = bar.current;
    if (!target) return;
    const fill = target.querySelector<HTMLElement>(".trk b")!, thumb = target.querySelector<HTMLElement>(".thumb")!, figure = target.querySelector("svg")!;
    let last = window.scrollY, idle: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
      target.classList.toggle("show", window.scrollY > (document.getElementById("hero")?.offsetHeight ?? window.innerHeight) * .75);
      target.setAttribute("aria-valuenow", String(Math.round(p * 100)));
      fill.style.transform = `scaleY(${p})`; thumb.style.transform = `translateY(${p * target.clientHeight}px)`;
      clearTimeout(idle);
      if (!reduce && window.scrollY !== last) {
        figure.style.transform = `rotate(${Math.max(-1, Math.min(1, (window.scrollY - last) / 40)) * 16}deg)`;
        idle = setTimeout(() => { figure.style.transform = ""; }, 140);
      }
      last = window.scrollY;
    };
    paint(); window.addEventListener("scroll", paint, { passive: true }); window.addEventListener("resize", paint);
    return () => { clearTimeout(idle); window.removeEventListener("scroll", paint); window.removeEventListener("resize", paint); };
  }, [reduce]);
  const go = (position: number) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const value = Math.max(0, Math.min(max, position));
    if (lenis.current) lenis.current.scrollTo(value, { immediate: true }); else window.scrollTo(0, value);
  };
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height) go((event.clientY - rect.top) / rect.height * (document.documentElement.scrollHeight - window.innerHeight));
  };
  const release = () => { down.current = false; bar.current?.classList.remove("drag"); };
  return <div ref={bar} className="sbar" role="scrollbar" aria-label="Page scroll position" aria-controls="top" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} tabIndex={0}
    onPointerDown={event => { down.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add("drag"); point(event); }}
    onPointerMove={event => { if (down.current) point(event); }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={event => {
      const keys: Record<string, number> = { ArrowDown: window.scrollY + 80, ArrowUp: window.scrollY - 80, PageDown: window.scrollY + window.innerHeight, PageUp: window.scrollY - window.innerHeight, Home: 0, End: document.documentElement.scrollHeight };
      if (event.key in keys) { event.preventDefault(); go(keys[event.key]); }
    }}><i className="trk" aria-hidden="true"><b /></i><div className="thumb" aria-hidden="true"><span><Mascot /></span></div></div>;
}
