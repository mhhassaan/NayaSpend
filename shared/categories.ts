export const CANONICAL_CATEGORIES = ["Transfers", "Health", "Food & Dining", "Groceries", "Transport", "Utilities", "Uncategorized"];

export type TransactionSuggestion = {
  category?: string;
  vendor?: string;
  // Positive magnitude in integer paisa, like transactions.amount.
  amount?: number;
  direction?: "in" | "out";
  suggestedAt: string;
  model: string;
};
