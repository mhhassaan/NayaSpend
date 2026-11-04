// Single source of truth for the rupees <-> cents boundary. The backend
// always stores/returns integer cents; every form in this app that lets a
// person type a rupee amount must go through parseRupeesToCents before
// sending it, and formatCents on the way back out.

export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseRupeesToCents(rupees: string): number {
  return Math.round(Number.parseFloat(rupees) * 100);
}
