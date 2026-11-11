import { useEffect, useRef } from "react";
import Lenis from "lenis";

export function useLenis(reduce: boolean) {
  const instance = useRef<Lenis | null>(null);
  useEffect(() => {
    if (reduce || typeof window.matchMedia !== "function" || typeof ResizeObserver === "undefined" || typeof requestAnimationFrame === "undefined") return;
    const lenis = new Lenis({ lerp: .09, wheelMultiplier: .9, anchors: { offset: -80 } });
    instance.current = lenis;
    let frame = requestAnimationFrame(function raf(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });
    return () => { cancelAnimationFrame(frame); lenis.destroy(); instance.current = null; };
  }, [reduce]);
  return instance;
}
