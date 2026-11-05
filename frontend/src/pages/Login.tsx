// A real anchor, not the Button component -- this must be a full page
// navigation to the backend's OAuth redirect, not a client-side route.
export function Login() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg-surface p-6">
      <div className="font-display text-[28px] font-bold text-blackberry">NayaSpend</div>
      <p className="font-body text-[15px] text-text-secondary">Sign in to see your spending.</p>
      <a
        href="/api/auth/google/login"
        className="rounded-md bg-blackberry px-6 py-3 font-body text-[15px] font-semibold text-hyper-white transition-transform active:scale-[0.96]"
      >
        Sign in with Google
      </a>
    </div>
  );
}
