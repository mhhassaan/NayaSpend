import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { Intro } from "../components/landing/Intro";
import { ProblemSection } from "../components/landing/ProblemSection";
import { TravelSection } from "../components/landing/TravelSection";
import { TourSection } from "../components/landing/TourSection";
import { PrivacySection } from "../components/landing/PrivacySection";
import { Finale } from "../components/landing/Finale";
import { ScrollMascotBar } from "../components/landing/ScrollMascotBar";
import { useLenis } from "../components/landing/useLenis";
import { useLandingMotion } from "../components/landing/useLandingMotion";
import "./Landing.css";

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const reduce = !!useReducedMotion();
  const lenis = useLenis(reduce);
  useLandingMotion(root, reduce);
  useLayoutEffect(() => {
    document.documentElement.classList.add("nayaspend-landing-scroll");
    return () => document.documentElement.classList.remove("nayaspend-landing-scroll");
  }, []);
  return <div ref={root} id="top" className="landing" data-reduced-motion={reduce ? "true" : undefined}>
    <header className="landing-header"><nav className="nav" aria-label="Main navigation"><a href="#top" aria-label="NayaSpend home"><b>NayaSpend</b></a><span><a href="#experience">Explore</a><a href="#privacy">Your privacy</a><a className="si" href="/login">Sign in</a></span></nav></header>
    <main><Intro reduce={reduce} /><ProblemSection reduce={reduce} /><TravelSection reduce={reduce} /><TourSection reduce={reduce} /><PrivacySection /><Finale reduce={reduce} /></main>
    <ScrollMascotBar reduce={reduce} lenis={lenis} />
  </div>;
}

