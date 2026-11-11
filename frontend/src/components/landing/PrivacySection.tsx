export function PrivacySection() {
  return <section className="priv" id="privacy" aria-labelledby="privacy-title"><div className="in"><h2 className="rv" id="privacy-title">Your spending story.<br />Your inbox stays yours.</h2>
    <div className="three"><article className="rv"><h3>Read-only Gmail access</h3><p>Auto-capture from NayaPay transaction emails. Read-only access cannot send or change your emails.</p></article>
      <article className="rv"><h3>Bring a statement</h3><p>CSV import gives you another way in. Dedup review catches possible duplicates.</p></article>
      <article className="rv"><h3>Leave whenever</h3><p>Disconnect Gmail or delete your data at any time.</p></article></div>
    <details className="rv"><summary>Is this NayaPay?</summary><p>No. NayaSpend is an independent companion, not affiliated with NayaPay. It helps organize your spending records.</p></details>
  </div></section>;
}
