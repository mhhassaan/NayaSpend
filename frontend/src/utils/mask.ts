// Statement-sourced vendor text (statementAdapter.ts's Description column)
// can carry account numbers or IBANs verbatim. Any run of 8 or more
// consecutive digits -- long enough to be an account/card number rather
// than an order number or amount -- is masked everywhere outside the
// upload's own flow.
const DIGIT_RUN = /\d{8,}/g;

export function maskAccountNumbers(text: string): string {
  return text.replace(DIGIT_RUN, (run) => "••••" + run.slice(-4));
}
