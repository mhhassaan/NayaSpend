import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { Logo } from "../components/Logo";
import { Scene, HeroInk } from "../components/landing/Scenes";
import { FriendlyArrowSymbol } from "../components/landing/FriendlyArrowSymbol";
import { Mascot } from "../components/landing/Mascot";
import "./Landing.css";

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const page = root.current;
    if (!page || reduceMotion || typeof IntersectionObserver === "undefined") return;
    page.querySelectorAll(".waypoints, .toolkit, .three").forEach(group => {
      Array.from(group.children).filter(el => el.matches("article, a")).forEach((el, i) => {
        el.classList.add("reveal");
        (el as HTMLElement).style.setProperty("--stagger", `${(i % 5) * 60}ms`);
      });
    });
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.1 });
    page.classList.add("js");
    page.querySelectorAll(".reveal").forEach(el => observer.observe(el));
    return () => { observer.disconnect(); page.classList.remove("js"); };
  }, [reduceMotion]);

  useEffect(() => {
    const card = root.current?.querySelector<HTMLElement>(".floating");
    if (!card || reduceMotion || typeof matchMedia === "undefined") return;
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    const move = (event: PointerEvent) => {
      if (!fine.matches || event.pointerType === "touch") return;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg) translateY(-8px)`;
    };
    const reset = () => { card.style.removeProperty("transform"); };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerleave", reset);
    fine.addEventListener("change", reset);
    return () => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerleave", reset);
      fine.removeEventListener("change", reset);
      reset();
    };
  }, [reduceMotion]);

  return <div ref={root} id="top" className="landing journey-page refined-b bg-hyper-white text-blackberry font-body" data-reduced-motion={reduceMotion ? "true" : undefined}>
    <FriendlyArrowSymbol />
      <header>
      <nav aria-label="Main navigation"><a className="logo" href="#top" aria-label="NayaSpend home"><Logo className="text-[23px] max-[760px]:text-[20px]" /></a>
      <div className="navlinks"><a href="#experience">Explore <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></a><a href="#privacy">Your privacy <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></a><a className="signin" href="/api/auth/google/login">Sign in</a></div></nav></header>
      <main>
      <section id="hero" className="hoverhero">
      <div className="mx-auto max-w-[1280px] wrap split intro">
      <div className="hero-copy">
      <h1>Spending happens.<br /><em><span className="clarity">Clarity<svg className="swoosh illustration" viewBox="0 0 250 24" aria-hidden="true" focusable="false"><path d="M5 17 Q110 1 240 12 Q132 9 28 22" fill="none" stroke="#ff5018" strokeWidth="3.2" strokeLinecap="round"/></svg></span> follows.</em></h1>
      <p>A spending companion that turns your NayaPay transaction emails into categories, budgets and trends.</p>
      <div className="actions flex flex-wrap gap-3"><a className="btn" href="#experience">Take a look <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></a><a className="btn secondary" href="/api/auth/google/login">Get started <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></a></div>
      <p className="small">Independent companion. Read-only Gmail access.</p>
      <div className="hero-proof"><span><svg className="micro illustration" data-story="proof-2" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M3 8 L25 7 L26 23 L4 24 Z M4 9 L15 17 L24 9" transform="translate(1 1)" fill="url(#soft-ember)"/><g fill="none" stroke="#381d2a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" filter="url(#roughen)"><path d="M3 8 L25 7 L26 23 L4 24 Z M4 9 L15 17 L24 9" fill="none" strokeWidth="1.6"/></g></svg>Capture emails</span><span><svg className="micro illustration" data-story="proof-1" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M7 10 Q16 6 23 11 L22 26 Q15 29 8 25 Z M7 10 Q15 14 23 11 M13 3 L19 3" transform="translate(1 1)" fill="url(#soft-silver)"/><g fill="none" stroke="#381d2a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" filter="url(#roughen)"><path d="M7 10 Q16 6 23 11 L22 26 Q15 29 8 25 Z M7 10 Q15 14 23 11 M13 3 L19 3" fill="none" strokeWidth="1.6"/></g></svg>Set budgets</span><span><svg className="micro illustration" data-story="proof-0" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 25 L5 19 L10 19 L11 25 M14 25 L14 12 L19 12 L20 25 M24 25 L24 4 L29 4 L29 25" transform="translate(1 1)" fill="url(#soft-violet)"/><g fill="none" stroke="#381d2a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" filter="url(#roughen)"><path d="M4 25 L5 19 L10 19 L11 25 M14 25 L14 12 L19 12 L20 25 M24 25 L24 4 L29 4 L29 25" fill="none" strokeWidth="1.6"/></g></svg>See trends</span></div></div>
      <div className="hero-stack">
      <div className="hero-arrival reveal">
      <div className="floating card"><HeroInk /><span className="eyebrow">Your month, in context</span>
      <h3>A little coffee.<br />A bigger picture.</h3>
      <div className="row"><span>KAFI</span><strong>PKR 850</strong></div>
      <div className="row"><span>Category</span><span className="tag">Food &amp; drink</span></div>
      <div className="bar"><i></i></div>
      <p className="small">Food &amp; drink budget. PKR 12,400 of PKR 20,000</p></div></div>
      <div className="hero-pills"><span className="orbit pill">Email <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg> Insight</span><span className="orbit second pill">Less manual sorting</span></div></div></div></section>
      <section className="mx-auto max-w-[1280px] wrap workflow"><span className="eyebrow">Follow one little purchase</span>
      <h2>From inbox detail<br />to a bigger picture.</h2>
      <p>One PKR 850 KAFI coffee, seen in five useful ways.</p>
      <div className="waypoints">
      <article className="waypoint reveal"><Scene number={1} /><strong>01. Email</strong>
      <p>A NayaPay transaction email.<br />Read-only Gmail</p></article>
      <article className="waypoint reveal"><Scene number={2} /><strong>02. Transaction</strong>
      <p>KAFI. PKR 850<br />An organized record</p></article>
      <article className="waypoint reveal"><Scene number={3} /><strong>03. Category</strong>
      <p>Food &amp; drink<br />A useful place to start</p></article>
      <article className="waypoint reveal"><Scene number={4} /><strong>04. Budget</strong>
      <p>PKR 12,400 of PKR 20,000<br />Spending against your plan</p></article>
      <article className="waypoint reveal"><Scene number={5} /><strong>05. Trend</strong>
      <p>Your month, in context<br />Step back and see patterns</p></article></div></section>
      <section className="mx-auto max-w-[1280px] wrap" id="experience">
      <div className="shelfheading">
      <div><span className="eyebrow">Follow the details</span>
      <h2>Go on. Explore a little.</h2></div></div>
      <p className="small muted">Follow the details, one step at a time. Just scroll down.</p>
      <div className="chapter-journey">
      <div className="chapter-rail" aria-hidden="true"><Mascot /></div>
      <div className="track" role="region" aria-label="NayaSpend features">
      <article className="feature reveal bg-electric-orange" id="feature-1"><span className="eyebrow">01. Capture</span>
      <div className="chapter-main">
      <div className="journey-badge"><Scene number={6} /><span>Waypoint 1. KAFI email arrives</span></div>
      <div className="feature-copy">
      <h3>Your inbox.<br />Already on it.</h3>
      <p>Auto-capture NayaPay transaction emails through read-only Gmail access.</p></div></div>
      <div className="miniemail">INBOX <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg> TRANSACTION<br /><strong>KAFI. PKR 850</strong></div></article>
      <article className="feature reveal bg-vivid-violet" id="feature-2"><span className="eyebrow">02. Categorize</span>
      <div className="chapter-main">
      <div className="journey-badge"><Scene number={7} /><span>Waypoint 2. KAFI finds a category</span></div><svg className="brand-arrow chapter-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg>
      <div className="feature-copy">
      <h3>A place for<br />every purchase.</h3>
      <p>Categorization makes your transaction list easier to explore.</p></div></div>
      <div className="categorychips"><span>Food &amp; drink</span><span>KAFI</span><span>CBTL</span></div></article>
      <article className="feature reveal bg-bubblegum" id="feature-3"><span className="eyebrow">03. Budget</span>
      <div className="chapter-main">
      <div className="journey-badge"><Scene number={8} /><span>Waypoint 3. KAFI in your plan</span></div>
      <div className="feature-copy">
      <h3>A plan you<br />can follow.</h3>
      <p>Set category budgets and see your spending against the plan.</p></div></div>
      <div className="miniemail"><strong>Food &amp; drink. PKR 12,400 of PKR 20,000</strong>
      <div className="bar"><i></i></div>62% of this month's plan</div></article>
      <article className="feature reveal bg-blackberry text-hyper-white" id="feature-4"><span className="eyebrow">04. Remind</span>
      <div className="chapter-main">
      <div className="journey-badge"><Scene number={9} /><span>Waypoint 4. Upcoming payments</span></div><svg className="brand-arrow chapter-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg>
      <div className="feature-copy">
      <h3>Keep bills<br />in the picture.</h3>
      <p>Bill reminders keep dues like PTCL and Nayatel on your radar.</p></div></div>
      <div className="miniemail"><strong>PTCL broadband</strong><br />PKR 3,499. Due 15 Nov</div></article>
      <article className="feature reveal bg-light-purple" id="feature-5"><span className="eyebrow">05. Understand</span>
      <div className="chapter-main">
      <div className="journey-badge"><Scene number={10} /><span>Waypoint 5. KAFI in a wider view</span></div>
      <div className="feature-copy">
      <h3>Zoom out.<br />See the pattern.</h3>
      <p>Explore trends. Add CSV records and review possible duplicates.</p></div></div>
      <div className="miniemail">NayaPay statement CSV <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg> Dedup review<br /><strong>KAFI PKR 850, kept once</strong></div></article></div></div></section>
      <section className="mx-auto max-w-[1280px] wrap"><span className="eyebrow">Keep the useful bits together</span>
      <h2>Capture. Sort. Plan. Repeat.</h2>
      <p>A few useful tools, working toward the same clearer picture.</p>
      <div className="toolkit"><a className="tool" href="#feature-1"><Scene number={11} />
      <div>
      <h3>Gmail auto-capture</h3>
      <p>Let NayaPay transaction emails become organized records with read-only access.</p><span className="small">Explore <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></span></div></a><a className="tool" href="#feature-5"><Scene number={12} />
      <div>
      <h3>CSV import</h3>
      <p>Bring transactions from a NayaPay CSV statement into the same spending picture.</p><span className="small">Explore <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></span></div></a><a className="tool" href="#privacy"><Scene number={13} />
      <div>
      <h3>Dedup review</h3>
      <p>Look over possible matches before deciding which records to keep.</p><span className="small">Explore <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></span></div></a><a className="tool" href="#feature-5"><Scene number={14} />
      <div>
      <h3>Spending trends</h3>
      <p>Step back from individual purchases and explore patterns across your month.</p><span className="small">Explore <svg className="brand-arrow" viewBox="0 0 36 24" aria-hidden="true"><use href="#friendly-arrow"/></svg></span></div></a></div></section>
      <section className="privacy" id="privacy">
      <div className="mx-auto max-w-[1280px] wrap"><span className="eyebrow">A companion, with clear boundaries</span>
      <h2>Your spending story.<br />Your inbox stays yours.</h2>
      <div className="trust-scene"><Scene number={15} />
      <p>The journey starts with read-only access. You stay in control of your inbox.</p></div>
      <div className="three grid grid-cols-3 gap-[22px] max-[760px]:grid-cols-1">
      <article>
      <h3>Read-only Gmail access</h3>
      <p>Auto-capture from NayaPay transaction emails. Read-only access cannot send or change your emails.</p></article>
      <article>
      <h3>Bring a statement</h3>
      <p>CSV import gives you another way to add transactions. Dedup review helps you review possible duplicates.</p></article>
      <article>
      <h3>Plan the next month</h3>
      <p>Set category budgets, use bill reminders and explore spending trends in one companion.</p></article></div>
      <details>
      <summary>Is this NayaPay?</summary>
      <p>No. NayaSpend is an independent companion, not affiliated with NayaPay. It helps organize your spending records.</p></details></div></section>
      <section className="mx-auto max-w-[1280px] wrap" id="start">
      <div className="closing"><Scene number={16} /><span className="eyebrow">Less sorting. More understanding.</span>
      <h2>Make sense of your spending.</h2>
      <p>Read-only Gmail access. You stay in control of your inbox.</p>
      <div className="actions flex flex-wrap gap-3"><a className="btn signin" href="/api/auth/google/login">Sign in with Google</a></div>
      <p className="small">Amounts shown in previews are illustrative.</p></div></section></main>
      <footer><strong>NayaSpend. Independent spending companion</strong><span>Not affiliated with NayaPay. Amounts shown in previews are illustrative.</span>
      <div className="footer-links"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="#top">Back to top</a></div></footer>
  </div>;
}
