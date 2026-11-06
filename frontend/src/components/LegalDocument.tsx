import { type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Logo } from "./Logo";

interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

export function LegalDocument({ title, lead, sections }: {
  title: "Terms of Service" | "Privacy Policy";
  lead: string;
  sections: LegalSection[];
}) {
  const terms = title === "Terms of Service";
  const wrap = "mx-auto max-w-[1160px] px-5 sm:px-8";
  const linkStyle = "underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-deep-violet focus-visible:outline-offset-4";
  return (
    <div className="min-h-screen bg-bg-surface font-body text-text-primary">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-3 focus:z-20 focus:bg-bg-surface focus:p-3">Skip to content</a>
      <header className="border-b border-border print:hidden">
        <div className={`${wrap} flex min-h-[90px] flex-wrap items-center justify-between gap-6 py-5`}>
          <Link to="/welcome" aria-label="NayaSpend home" className={linkStyle}><Logo className="text-[22px]" /></Link>
          <nav aria-label="Main navigation" className="flex flex-wrap gap-6 text-sm">
            <Link to="/welcome" className={linkStyle}>Back to welcome</Link>
            <NavLink to="/terms" className={`${linkStyle} aria-[current=page]:underline decoration-accent decoration-2`}>Terms of Service</NavLink>
            <NavLink to="/privacy" className={`${linkStyle} aria-[current=page]:underline decoration-accent decoration-2`}>Privacy Policy</NavLink>
          </nav>
        </div>
      </header>
      <main id="content" tabIndex={-1}>
        <div className={`${wrap} pb-11 pt-12 sm:pt-16`}>
          <h1 className="my-5 font-display text-[clamp(38px,5vw,60px)] font-bold leading-[1.15] tracking-[-.05em]">{title}</h1>
          <p className="max-w-[650px] text-xl leading-relaxed">{lead}</p>
          <p className="mt-6 text-[13px]">Updated / <time dateTime="2026-11-06">06 November 2026</time></p>
        </div>
        <div className={`${wrap} grid gap-7 pb-20 md:grid-cols-[240px_minmax(0,1fr)] md:gap-[70px] print:block`}>
          <aside className="sticky top-0 z-10 max-h-[200px] self-start overflow-auto border-t-2 border-text-primary bg-bg-surface py-4 md:top-7 md:max-h-[calc(100dvh-56px)] print:hidden">
            <nav aria-label="On this page" className="text-sm">
              <strong>On this page</strong>
              <ol className="mt-2 flex gap-5 md:mt-4 md:block">
                {sections.map((section, i) => <li key={section.id} className="w-[190px] shrink-0 md:w-auto">
                  <a href={`#${section.id}`} className={`${linkStyle} block py-2 leading-normal hover:text-danger`}><span className="mr-2 text-[11px] font-bold text-deep-violet">{String(i + 1).padStart(2, "0")}</span>{section.title}</a>
                </li>)}
              </ol>
            </nav>
          </aside>
          <div className="min-w-0 max-w-[690px]">
            {sections.map((section, i) => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-[210px] border-t border-border py-[34px] md:scroll-mt-7 print:break-inside-avoid">
              <span className="mb-3 block text-xs font-bold tracking-widest text-deep-violet">{String(i + 1).padStart(2, "0")}</span>
              <h2 id={`${section.id}-title`} className="mb-[18px] font-display text-[23px] font-bold leading-snug tracking-tight">{section.title}</h2>
              <div className="break-words text-[17px] leading-[1.75] [&>p]:mb-[18px] [&>p:last-child]:mb-0 [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline [&_a:focus-visible]:outline-deep-violet">{section.content}</div>
            </section>)}
          </div>
        </div>
        <div className={wrap}><p className="border-t border-border py-7 text-[15px]">{terms ? "Want to understand the data side too? " : "Looking for the terms of using the companion? "}<Link className={`${linkStyle} underline`} to={terms ? "/privacy" : "/terms"}>Read the {terms ? "Privacy Policy" : "Terms of Service"}</Link>.</p></div>
      </main>
      <footer className="border-t border-border bg-bg-page py-9 text-[13px] print:hidden">
        <div className={`${wrap} flex flex-col justify-between gap-5 sm:flex-row sm:gap-11`}><strong>NayaSpend<br />A personal spending companion.</strong><p className="max-w-[660px]">{terms ? "An independent personal project, built by one person for their own spending." : "For the service boundaries and rules of use, read the Terms of Service."}</p></div>
      </footer>
    </div>
  );
}
