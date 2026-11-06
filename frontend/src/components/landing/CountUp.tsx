import { useEffect, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

// Counts up to a final amount the first time it scrolls into view. The final value is
// always the rendered content, so tests, no-JS and reduced motion see the real number.
export function CountUp({ to, suffix = "", duration = 1400 }: { to: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const format = (n: number) => Math.round(n).toLocaleString("en-US") + suffix;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion || typeof IntersectionObserver === "undefined") return;
    let frame = 0;
    el.textContent = format(0);
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      let start: number | undefined;
      const tick = (now: number) => {
        start ??= now;
        const t = Math.min(1, Math.max(0, (now - start) / duration));
        el.textContent = format(to * (1 - Math.pow(1 - t, 3)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); el.textContent = format(to); };
  }, [to, suffix, duration, reduceMotion]);
  return <span ref={ref} suppressHydrationWarning>{format(to)}</span>;
}
