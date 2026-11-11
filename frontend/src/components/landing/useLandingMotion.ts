import { useEffect, type RefObject } from "react";
import { animate, inView, spring } from "motion";

export const easeOut = [.23, 1, .32, 1] as const;

export function useLandingMotion(root: RefObject<HTMLDivElement>, reduce: boolean) {
  useEffect(() => {
    const page = root.current;
    if (!page || reduce || typeof IntersectionObserver === "undefined") return;
    const animations: ReturnType<typeof animate>[] = [];
    const stops: (() => void)[] = [];
    page.querySelectorAll<HTMLElement>(".pre").forEach((el, i) => {
      animations.push(animate(el, { opacity: [0, 1], transform: [`translateY(${i === 0 ? 30 : 14}px)`, "translateY(0px)"] }, { type: spring, duration: .75, bounce: .1, delay: [0, .1, .16, .28][i] ?? .28 }));
    });
    page.querySelectorAll<HTMLElement>(".rv").forEach(el => {
      stops.push(inView(el, () => {
        animations.push(animate(el, { opacity: [0, 1], transform: [`translateY(${el.tagName === "H2" ? 26 : 14}px)`, "translateY(0px)"] }, { type: spring, duration: .7, bounce: .08 }));
      }, { amount: .3 }));
    });
    return () => {
      stops.forEach(stop => stop());
      animations.forEach(animation => animation.stop());
      // Stopping WAAPI freezes its current frame. Preference changes must
      // leave every reveal readable rather than retaining a partial fade.
      page.querySelectorAll<HTMLElement>(".pre, .rv").forEach(el => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    };
  }, [root, reduce]);
}
