import { Logo } from "../components/Logo";
import { InkDefinitions } from "../components/ink/InkDefinitions";
import { InkScene } from "../components/ink/InkScene";
import { InkTrend } from "../components/ink/InkTrend";
import { InkTrust } from "../components/ink/InkTrust";
import "./Login.css";

// OAuth requires a full page navigation to the backend redirect.
export function Login() {
  return (
    <main className="login-page bg-bg-page">
      <InkDefinitions />
      <div className="login-stage">
        <div className="login-split">
          <section aria-labelledby="signin-title" className="login-signin">
      <Logo variant="lockup" className="text-xl" />
      <h1 id="signin-title" className="font-display text-3xl font-bold text-text-primary">A little clarity starts here.</h1>
      <p className="font-body text-[15px] text-text-secondary">Sign in to see your spending.</p>
      <a
        href="/api/auth/google/login"
        className="login-cta rounded-md bg-blackberry px-6 py-3 text-center font-body text-[15px] font-semibold text-hyper-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-deep-violet focus-visible:outline-offset-4"
      >
        Sign in with Google
      </a>
      <p className="text-center font-body text-xs text-text-secondary">Gmail connection uses separate, read-only consent. NayaSpend cannot send, change or delete email.</p>
      <a href="/welcome" className="text-center text-sm text-text-secondary underline underline-offset-4">Learn more about NayaSpend</a>
      <nav aria-label="Legal" className="flex flex-wrap justify-center gap-4 text-xs underline underline-offset-4">
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
      </nav>
          </section>
          <aside aria-label="NayaSpend brand panel" className="login-brand hidden md:flex">
            <div className="login-brand-copy">
              <p className="login-eyebrow">A little more clarity</p>
              <h2>Your spending.<br />A clearer picture.</h2>
              <p className="text-text-secondary">Pick up the thread, one transaction at a time.</p>
            </div>
            <InkScene />
            <div>
              <div className="login-chips" aria-label="01 Connect, then 02 Sort, then 03 Plan, then 04 Understand">
                {["01 Connect", "02 Sort", "03 Plan", "04 Understand"].map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
              <p className="login-small text-text-secondary">Four small steps. One clearer view.</p>
              <p className="login-signoff text-text-secondary">Your month, made clearer.</p>
            </div>
          </aside>
        </div>
        <InkTrend />
        <InkTrust />
      </div>
    </main>
  );
}
